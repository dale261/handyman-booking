export type AiRead = {
  source: "openai" | "rules";
  assumptions: string[];
  licenseNote: string | null;
  scopeHint: string | null;
};

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
              "You help eX Construction LC in Cadillac, Michigan understand a handyman request. Do not invent prices or dollar amounts. Return JSON with keys scope (string), assumptions (array of short strings), and licenseConcern (string or null). Set licenseConcern only if the work may need a licensed electrician, plumber, mechanical or HVAC contractor, asbestos abatement, or residential builder. Otherwise null.",
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
