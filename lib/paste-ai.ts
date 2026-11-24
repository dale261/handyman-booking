import { PASTE_SCHEMA, PASTE_SYSTEM, pasteUserContent } from "@/lib/domain/paste-fill";

/**
 * The AI reader behind the paste box on Add a job. It only reads the owner's note into
 * form fields; lib/domain/paste-fill.ts checks every value against the note before the
 * form is touched. No key, a failed call, or a test run returns null and the built-in
 * reader is used instead. Claude is asked first, then OpenAI, like the unlisted quotes.
 */

/** Which service will read the note, or null when no key is set. Names only; never the key. */
export function pasteModelConfigured(): "anthropic" | "openai" | null {
  if ((process.env.ANTHROPIC_API_KEY || "").trim()) return "anthropic";
  if ((process.env.OPENAI_API_KEY || "").trim()) return "openai";
  return null;
}

/** The first {...} in the reply, parsed. Handles a reply wrapped in a code fence or a sentence. */
export function jsonFromReply(raw: string): unknown | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

async function askClaude(user: string, withSchema: boolean): Promise<{ status: number; value: unknown | null }> {
  const key = (process.env.ANTHROPIC_API_KEY || "").trim();
  const system = withSchema ? PASTE_SYSTEM : `${PASTE_SYSTEM}\n\nReturn one JSON object only, matching this schema:\n${JSON.stringify(PASTE_SCHEMA)}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      // A small, fast model is plenty for reading a note. Set ANTHROPIC_PASTE_MODEL to use a different one.
      model: process.env.ANTHROPIC_PASTE_MODEL || "claude-haiku-5-5",
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
      ...(withSchema ? { output_config: { format: { type: "json_schema", schema: PASTE_SCHEMA } } } : {}),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    console.error("[paste] Claude returned", res.status);
    return { status: res.status, value: null };
  }
  const body = (await res.json()) as { stop_reason?: string; content?: { type?: string; text?: string }[] };
  if (body.stop_reason === "refusal") return { status: 200, value: null };
  const raw = (body.content ?? []).filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
  return { status: 200, value: jsonFromReply(raw) };
}

async function readWithClaude(user: string): Promise<unknown | null> {
  if (!(process.env.ANTHROPIC_API_KEY || "").trim()) return null;
  try {
    const first = await askClaude(user, true);
    if (first.value) return first.value;
    // A 400 means the request itself was turned down (for example a model that doesn't take the schema): ask once more in plain words.
    if (first.status !== 400) return null;
    return (await askClaude(user, false)).value;
  } catch (error) {
    console.error("[paste] Claude request failed", error instanceof Error ? error.message : "request failed");
    return null;
  }
}

async function readWithOpenAI(user: string): Promise<unknown | null> {
  const key = (process.env.OPENAI_API_KEY || "").trim();
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        temperature: 0,
        response_format: { type: "json_schema", json_schema: { name: "job_note", strict: true, schema: PASTE_SCHEMA } },
        messages: [
          { role: "system", content: PASTE_SYSTEM },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) {
      console.error("[paste] OpenAI returned", res.status);
      return null;
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return jsonFromReply(body.choices?.[0]?.message?.content ?? "");
  } catch (error) {
    console.error("[paste] OpenAI request failed", error instanceof Error ? error.message : "request failed");
    return null;
  }
}

/**
 * Ask the model to read the note. The answer is unchecked JSON: pass it to fillFromModel().
 * Tests never call the model unless they ask to.
 */
export async function readPasteWithModel(text: string, today: string, options?: { allowModel?: boolean }): Promise<unknown | null> {
  if (process.env.VITEST && options?.allowModel !== true) return null;
  const user = pasteUserContent(text, today);
  return (await readWithClaude(user)) ?? (await readWithOpenAI(user));
}
