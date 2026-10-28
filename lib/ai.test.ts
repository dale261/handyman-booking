import { afterEach, describe, expect, it, vi } from "vitest";
import { matchUnlistedJob, readJobDescription } from "@/lib/ai";
import type { LibraryEntry } from "@/lib/domain/library-data";

const library: LibraryEntry[] = [
  {
    id: "baseboard",
    name: "Baseboard",
    group: "handy",
    unit: "ft",
    nationalLow: 2,
    nationalHigh: 8,
    localLow: null,
    localHigh: null,
    source: "test",
    notes: "",
    keywords: ["baseboard"],
    performs: true,
    sortOrder: 1,
    suppressIds: [],
  },
];

const description = "Install 40 feet of baseboard in the hallway";

function payload(quantity: number) {
  return {
    items: [{ id: "baseboard", quantity }],
    estimatedHours: 2,
    materials: 0,
    confidence: "high",
    vague: false,
    reasoning: "Baseboard along the hallway.",
    assumptions: ["Paint-grade board"],
    licenseConcern: null,
  };
}

function claudeResponse(text: string, stopReason = "end_turn") {
  return new Response(JSON.stringify({ stop_reason: stopReason, content: [{ type: "text", text }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function openaiResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const saved = {
  anthropic: process.env.ANTHROPIC_API_KEY,
  openai: process.env.OPENAI_API_KEY,
  anthropicModel: process.env.ANTHROPIC_MODEL,
  openaiModel: process.env.OPENAI_MODEL,
  fetch: globalThis.fetch,
};

afterEach(() => {
  restore("ANTHROPIC_API_KEY", saved.anthropic);
  restore("OPENAI_API_KEY", saved.openai);
  restore("ANTHROPIC_MODEL", saved.anthropicModel);
  restore("OPENAI_MODEL", saved.openaiModel);
  globalThis.fetch = saved.fetch;
  vi.restoreAllMocks();
});

function restore(name: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_MODEL" | "OPENAI_MODEL", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function callsOf(spy: ReturnType<typeof vi.fn>) {
  return spy.mock.calls.map((call) => {
    const url = String(call[0]);
    const init = (call[1] ?? {}) as RequestInit;
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const headers = new Headers(init.headers);
    return { url, body, headers };
  });
}

describe("unlisted quote providers", () => {
  it("uses Claude for a valid unlisted match and does not call OpenAI", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";
    delete process.env.ANTHROPIC_MODEL;
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      return claudeResponse(JSON.stringify(payload(7)));
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const match = await matchUnlistedJob(description, library, { allowModel: true });
    expect(match.source).toBe("anthropic");
    expect(match.selection.items).toEqual([{ id: "baseboard", quantity: 7 }]);
    const [call] = callsOf(fetchSpy);
    expect(call.headers.get("x-api-key")).toBe("anthropic-test-key");
    expect(call.headers.get("anthropic-version")).toBe("2023-06-01");
    expect(call.body?.model).toBe("claude-sonnet-5-5");
    expect(call.body?.max_tokens).toBe(8000);
    expect(call.body?.output_config).toEqual({ format: { type: "json_schema", schema: expect.any(Object) } });
    expect(String(call.body?.system)).toContain("Do not invent prices");
    expect(String(call.body?.messages && (call.body.messages as { content: string }[])[0]?.content)).toContain(description);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries Claude once after a refusal, then accepts the JSON", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    delete process.env.OPENAI_API_KEY;
    const fetchSpy = vi.fn(async () => claudeResponse("no", "refusal"));
    fetchSpy
      .mockResolvedValueOnce(claudeResponse("no", "refusal"))
      .mockResolvedValueOnce(claudeResponse(JSON.stringify(payload(9))));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const match = await matchUnlistedJob(description, library, { allowModel: true });
    expect(match.source).toBe("anthropic");
    expect(match.selection.items[0]?.quantity).toBe(9);
    const calls = callsOf(fetchSpy);
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.url === "https://api.anthropic.com/v1/messages")).toBe(true);
    expect(String(calls[0]?.body?.system)).not.toContain("Return one JSON object only");
    expect(String(calls[1]?.body?.system)).toContain("Return one JSON object only");
    expect(String(calls[1]?.body?.system)).toContain("licenseConcern");
  });

  it("retries Claude once when the JSON does not validate", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    delete process.env.OPENAI_API_KEY;
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(claudeResponse(JSON.stringify({ nope: true })))
      .mockResolvedValueOnce(claudeResponse(JSON.stringify(payload(4))));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const match = await matchUnlistedJob(description, library, { allowModel: true });
    expect(match.source).toBe("anthropic");
    expect(match.selection.items[0]?.quantity).toBe(4);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("falls through to OpenAI when Claude fails", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";
    delete process.env.OPENAI_MODEL;
    const fetchSpy = vi.fn(async (url: string) => {
      if (String(url).includes("anthropic")) return new Response("nope", { status: 500 });
      return openaiResponse(payload(5));
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const match = await matchUnlistedJob(description, library, { allowModel: true });
    expect(match.source).toBe("openai");
    expect(match.selection.items).toEqual([{ id: "baseboard", quantity: 5 }]);
    const calls = callsOf(fetchSpy);
    expect(calls.map((call) => call.url)).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://api.openai.com/v1/chat/completions",
    ]);
    expect(calls[1]?.body?.model).toBe("gpt-4.1-mini");
    expect(calls[1]?.headers.get("authorization")).toBe("Bearer openai-test-key");
    expect(String((calls[1]?.body?.messages as { content: string }[])[0]?.content)).toBe(String(calls[0]?.body?.system));
  });

  it("uses the keyword matcher when Claude and OpenAI both fail", async () => {
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";
    const fetchSpy = vi.fn(async () => new Response("nope", { status: 503 }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const match = await matchUnlistedJob(description, library, { allowModel: true });
    expect(match.source).toBe("rules");
    expect(match.selection.items[0]?.id).toBe("baseboard");
    expect(match.selection.items[0]?.quantity).not.toBe(7);
    expect(callsOf(fetchSpy).map((call) => call.url)).toEqual([
      "https://api.anthropic.com/v1/messages",
      "https://api.openai.com/v1/chat/completions",
    ]);
  });

  it("keeps listed rate-sheet notes on OpenAI", async () => {
    process.env.OPENAI_API_KEY = "openai-test-key";
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    delete process.env.OPENAI_MODEL;
    const fetchSpy = vi.fn(async () =>
      openaiResponse({ scope: "Mount a TV", assumptions: ["Drywall"], licenseConcern: null }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const read = await readJobDescription("tv", "Mount a 55-inch TV on drywall", { allowModel: true });
    expect(read.source).toBe("openai");
    expect(read.scopeHint).toBe("Mount a TV");
    const calls = callsOf(fetchSpy);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(calls[0]?.body?.model).toBe("gpt-4.1-mini");
    expect(JSON.stringify(calls)).not.toContain("api.anthropic.com");
  });
});
