import { interpretUnlistedModel, keywordMatch, type LibrarySelection } from "@/lib/domain/library";
import type { LibraryEntry } from "@/lib/domain/library-data";

export type AiRead = {
  source: "openai" | "rules";
  assumptions: string[];
  licenseNote: string | null;
  scopeHint: string | null;
};

export type UnlistedMatch = {
  source: "anthropic" | "openai" | "rules";
  selection: LibrarySelection;
  reasoning: string;
  assumptions: string[];
  licenseConcern: string | null;
};

const UNLISTED_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          quantity: { type: "number" },
        },
        required: ["id", "quantity"],
      },
    },
    estimatedHours: { type: "number" },
    materials: { type: "number" },
    confidence: { type: "string", enum: ["high", "low"] },
    vague: { type: "boolean" },
    reasoning: { type: "string" },
    assumptions: { type: "array", items: { type: "string" } },
    licenseConcern: { type: ["string", "null"] },
  },
  required: ["items", "estimatedHours", "materials", "confidence", "vague", "reasoning", "assumptions", "licenseConcern"],
} as const;

const EMPTY: AiRead = { source: "rules", assumptions: [], licenseNote: null, scopeHint: null };

const UNLISTED_SYSTEM =
  "You match a handyman request for eX Construction LC in Cadillac, Michigan to ids from the cost library. Do not invent prices, dollar amounts, or ids that are not in the list. Return only library ids and quantities. estimatedHours is on-site labor. materials is your estimate of materials the crew must buy, in dollars, or 0 if the library price already covers them or the customer supplies them. confidence is high only when the description names the work and a quantity clearly. vague is true when the scope is unclear, missing a quantity you cannot infer, or covers several unrelated tasks. licenseConcern is a short sentence if the work may need a licensed electrician, plumber, mechanical contractor, or residential builder, otherwise null. Prefer the most specific id. Do not include an hourly labor id when a specific fixture id fits.";

function skipModelInTests(allowModel: boolean | undefined): boolean {
  return Boolean(process.env.VITEST) && allowModel !== true;
}

function unlistedUserContent(library: LibraryEntry[], description: string): string {
  const catalog = library
    .map((entry) => `${entry.id} | ${entry.name} | ${entry.unit} | ${entry.group} | ${entry.performs ? "we do this" : "refer out"}`)
    .join("\n");
  return `Library:\n${catalog}\n\nDescription: ${description}`;
}

function validUnlistedPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (!Array.isArray(body.items)) return false;
  for (const item of body.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string") return false;
    if (typeof row.quantity !== "number" || !Number.isFinite(row.quantity)) return false;
  }
  if (typeof body.estimatedHours !== "number" || !Number.isFinite(body.estimatedHours)) return false;
  if (typeof body.materials !== "number" || !Number.isFinite(body.materials)) return false;
  if (body.confidence !== "high" && body.confidence !== "low") return false;
  if (typeof body.vague !== "boolean") return false;
  if (typeof body.reasoning !== "string") return false;
  if (!Array.isArray(body.assumptions) || body.assumptions.some((item) => typeof item !== "string")) return false;
  if (!(body.licenseConcern === null || typeof body.licenseConcern === "string")) return false;
  return true;
}

function parseUnlistedText(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value = JSON.parse(raw) as unknown;
    return validUnlistedPayload(value) ? { ok: true, value } : { ok: false };
  } catch {
    return { ok: false };
  }
}

type ClaudeAttempt = { outcome: "valid"; value: unknown } | { outcome: "retry" } | { outcome: "fail" };

async function claudeUnlistedAttempt(system: string, user: string): Promise<ClaudeAttempt> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { outcome: "fail" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
        max_tokens: 8000,
        system,
        messages: [{ role: "user", content: user }],
        output_config: { format: { type: "json_schema", schema: UNLISTED_SCHEMA } },
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error("[ai] Claude returned", res.status);
      return { outcome: "fail" };
    }
    const body = (await res.json()) as {
      stop_reason?: string;
      content?: { type?: string; text?: string }[];
    };
    if (body.stop_reason === "refusal") {
      console.error("[ai] Claude refused the unlisted quote");
      return { outcome: "retry" };
    }
    const raw = (body.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
    const parsed = parseUnlistedText(raw);
    if (!parsed.ok) {
      console.error("[ai] Claude unlisted JSON failed to parse");
      return { outcome: "retry" };
    }
    return { outcome: "valid", value: parsed.value };
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    console.error("[ai] Claude request failed", message);
    return { outcome: "fail" };
  }
}

async function matchWithClaude(user: string): Promise<unknown | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const first = await claudeUnlistedAttempt(UNLISTED_SYSTEM, user);
  if (first.outcome === "valid") return first.value;
  if (first.outcome === "fail") return null;
  const retrySystem = `${UNLISTED_SYSTEM}\n\nReturn one JSON object only, matching this schema:\n${JSON.stringify(UNLISTED_SCHEMA)}`;
  const second = await claudeUnlistedAttempt(retrySystem, user);
  return second.outcome === "valid" ? second.value : null;
}

async function matchWithOpenAI(user: string): Promise<unknown | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.1,
        response_format: { type: "json_schema", json_schema: { name: "unlisted_job", strict: true, schema: UNLISTED_SCHEMA } },
        messages: [
          { role: "system", content: UNLISTED_SYSTEM },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error("[ai] OpenAI returned", res.status);
      return null;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) return null;
    const parsed = parseUnlistedText(raw);
    if (!parsed.ok) return null;
    return parsed.value;
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    console.error("[ai] OpenAI unlisted request failed", message);
    return null;
  }
}

/**
 * The model may describe the job and flag a license concern.
 * It never sets the price. If the key is missing or the call fails,
 * the quote is priced from the rate table and the keyword screen alone.
 */
export async function readJobDescription(
  service: string,
  description: string,
  options?: { allowModel?: boolean },
): Promise<AiRead> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || options?.allowModel === false || skipModelInTests(options?.allowModel)) return EMPTY;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You help eX Construction LC in Cadillac, Michigan understand a handyman request. Do not invent prices or dollar amounts. Describe only the service the customer selected. Do not mention a different service, such as TV mounting on a painting job. Return JSON with keys scope (string), assumptions (array of short strings), and licenseConcern (string or null). Set licenseConcern only if the work may need a licensed electrician, plumber, mechanical or HVAC contractor, asbestos abatement, or residential builder. Otherwise null.",
          },
          { role: "user", content: `Service selected: ${service}\nDescription: ${description}` },
        ],
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[ai] OpenAI returned", res.status);
      return EMPTY;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as { scope?: unknown; assumptions?: unknown; licenseConcern?: unknown };
    const assumptions = Array.isArray(parsed.assumptions)
      ? parsed.assumptions.map((item) => String(item)).filter(Boolean).slice(0, 6)
      : [];
    const licenseNote = typeof parsed.licenseConcern === "string" && parsed.licenseConcern.trim() ? parsed.licenseConcern.trim() : null;
    const scopeHint = typeof parsed.scope === "string" && parsed.scope.trim() ? parsed.scope.trim() : null;
    return { source: "openai", assumptions, licenseNote, scopeHint };
  } catch (error) {
    console.error("[ai] falling back to the rate table", error instanceof Error ? error.message : "request failed");
    return EMPTY;
  }
}

/**
 * Match an unlisted job to library ids. The model never sends a price.
 * A missing key, a test run, or a failed call uses the keyword matcher.
 * A successful reply with no usable ids stays empty so the hourly floor can send it to review.
 */
export async function matchUnlistedJob(
  description: string,
  library: LibraryEntry[],
  options?: { allowModel?: boolean },
): Promise<UnlistedMatch> {
  const rules = keywordMatch(description, library);
  const fallback: UnlistedMatch = {
    source: "rules",
    selection: {
      items: rules.items,
      estimatedHours: rules.estimatedHours,
      materials: rules.materials,
      confidence: rules.confidence,
      vague: rules.vague,
    },
    reasoning: rules.reasoning,
    assumptions: [],
    licenseConcern: null,
  };
  if (options?.allowModel === false || skipModelInTests(options?.allowModel)) return fallback;
  const user = unlistedUserContent(library, description);
  const claude = await matchWithClaude(user);
  if (claude) {
    console.info("[ai] unlisted quote answered by anthropic");
    return { source: "anthropic", ...interpretUnlistedModel(claude, library, description) };
  }
  const openai = await matchWithOpenAI(user);
  if (openai) {
    console.info("[ai] unlisted quote answered by openai");
    return { source: "openai", ...interpretUnlistedModel(openai, library, description) };
  }
  console.info("[ai] unlisted quote answered by keywords");
  return fallback;
}
