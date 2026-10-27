import { interpretUnlistedModel, keywordMatch, type LibrarySelection } from "@/lib/domain/library";
import type { LibraryEntry } from "@/lib/domain/library-data";

export type AiRead = {
  source: "openai" | "rules";
  assumptions: string[];
  licenseNote: string | null;
  scopeHint: string | null;
};

export type UnlistedMatch = {
  source: "openai" | "rules";
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

/**
 * The model may describe the job and flag a license concern.
 * It never sets the price. If the key is missing or the call fails,
 * the quote is priced from the rate table and the keyword screen alone.
 */
export async function readJobDescription(service: string, description: string): Promise<AiRead> {
  const key = process.env.OPENAI_API_KEY;
  if (!key || process.env.VITEST) return EMPTY;
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
    console.error("[ai] falling back to the rate table", error);
    return EMPTY;
  }
}

/**
 * Match an unlisted job to library ids. The model never sends a price.
 * A missing key, a test run, or a failed call uses the keyword matcher.
 * A successful reply with no usable ids stays empty so the hourly floor can send it to review.
 */
export async function matchUnlistedJob(description: string, library: LibraryEntry[]): Promise<UnlistedMatch> {
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
  const key = process.env.OPENAI_API_KEY;
  if (!key || process.env.VITEST) return fallback;
  try {
    const catalog = library
      .map((entry) => `${entry.id} | ${entry.name} | ${entry.unit} | ${entry.group} | ${entry.performs ? "we do this" : "refer out"}`)
      .join("\n");
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0.1,
        response_format: { type: "json_schema", json_schema: { name: "unlisted_job", strict: true, schema: UNLISTED_SCHEMA } },
        messages: [
          {
            role: "system",
            content:
              "You match a handyman request for eX Construction LC in Cadillac, Michigan to ids from the cost library. Do not invent prices, dollar amounts, or ids that are not in the list. Return only library ids and quantities. estimatedHours is on-site labor. materials is your estimate of materials the crew must buy, in dollars, or 0 if the library price already covers them or the customer supplies them. confidence is high only when the description names the work and a quantity clearly. vague is true when the scope is unclear, missing a quantity you cannot infer, or covers several unrelated tasks. licenseConcern is a short sentence if the work may need a licensed electrician, plumber, mechanical contractor, or residential builder, otherwise null. Prefer the most specific id. Do not include an hourly labor id when a specific fixture id fits.",
          },
          { role: "user", content: `Library:\n${catalog}\n\nDescription: ${description}` },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error("[ai] OpenAI returned", res.status);
      return fallback;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) return fallback;
    const interpreted = interpretUnlistedModel(JSON.parse(raw) as unknown, library, description);
    return { source: "openai", ...interpreted };
  } catch (error) {
    console.error("[ai] falling back to the keyword library match", error);
    return fallback;
  }
}
