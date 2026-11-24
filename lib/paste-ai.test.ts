import { afterEach, describe, expect, it } from "vitest";
import { jsonFromReply, pasteModelConfigured, readPasteWithModel } from "@/lib/paste-ai";

const realFetch = globalThis.fetch;
const realEnv = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, OPENAI_API_KEY: process.env.OPENAI_API_KEY };

type Call = { url: string; body: Record<string, unknown> };

/** Swap fetch for a list of canned replies, one per call, and record what was sent. */
function fakeFetch(replies: { status: number; json: unknown }[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
    const reply = replies[calls.length - 1] ?? { status: 500, json: {} };
    return new Response(JSON.stringify(reply.json), { status: reply.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}

function claude(text: string, stopReason = "end_turn") {
  return { status: 200, json: { stop_reason: stopReason, content: [{ type: "text", text }] } };
}

function setKey(name: "ANTHROPIC_API_KEY" | "OPENAI_API_KEY", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  setKey("ANTHROPIC_API_KEY", realEnv.ANTHROPIC_API_KEY);
  setKey("OPENAI_API_KEY", realEnv.OPENAI_API_KEY);
});

describe("jsonFromReply", () => {
  it("reads plain JSON, fenced JSON, and JSON with a sentence around it", () => {
    expect(jsonFromReply('{"title":"Hang a TV"}')).toEqual({ title: "Hang a TV" });
    expect(jsonFromReply('```json\n{"title":"Hang a TV"}\n```')).toEqual({ title: "Hang a TV" });
    expect(jsonFromReply('Here it is: {"title":"Hang a TV"} Done.')).toEqual({ title: "Hang a TV" });
  });

  it("returns null when there is no JSON to read", () => {
    expect(jsonFromReply("I can't help with that.")).toBeNull();
    expect(jsonFromReply('{"title": ')).toBeNull();
  });
});

describe("pasteModelConfigured", () => {
  it("names the service whose key is set, Claude first", () => {
    setKey("ANTHROPIC_API_KEY", undefined);
    setKey("OPENAI_API_KEY", undefined);
    expect(pasteModelConfigured()).toBeNull();
    setKey("OPENAI_API_KEY", "sk-test");
    expect(pasteModelConfigured()).toBe("openai");
    setKey("ANTHROPIC_API_KEY", "  ");
    expect(pasteModelConfigured()).toBe("openai");
    setKey("ANTHROPIC_API_KEY", "sk-ant-test");
    expect(pasteModelConfigured()).toBe("anthropic");
  });
});

describe("readPasteWithModel", () => {
  it("never calls a model in a test run unless asked to", async () => {
    setKey("ANTHROPIC_API_KEY", "sk-ant-test");
    const calls = fakeFetch([claude('{"title":"Hang a TV"}')]);
    expect(await readPasteWithModel("hang a tv", "2026-11-23")).toBeNull();
    expect(calls.length).toBe(0);
  });

  it("asks Claude with the schema and the small model, and returns its JSON", async () => {
    setKey("ANTHROPIC_API_KEY", "sk-ant-test");
    setKey("OPENAI_API_KEY", undefined);
    const calls = fakeFetch([claude('{"title":"Hang a TV"}')]);
    expect(await readPasteWithModel("hang a tv", "2026-11-23", { allowModel: true })).toEqual({ title: "Hang a TV" });
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0].body.model).toBe("claude-haiku-5-5");
    expect(Boolean(calls[0].body.output_config)).toBe(true);
    expect(JSON.stringify(calls[0].body.messages)).toContain("Today is 2026-11-23 (Monday).");
  });

  it("asks Claude once more in plain words when the request is turned down", async () => {
    setKey("ANTHROPIC_API_KEY", "sk-ant-test");
    setKey("OPENAI_API_KEY", undefined);
    const calls = fakeFetch([{ status: 400, json: { error: "bad request" } }, claude('```json\n{"title":"Hang a TV"}\n```')]);
    expect(await readPasteWithModel("hang a tv", "2026-11-23", { allowModel: true })).toEqual({ title: "Hang a TV" });
    expect(calls.length).toBe(2);
    expect(calls[1].body.output_config).toBe(undefined);
    expect(String(calls[1].body.system)).toContain("Return one JSON object only");
  });

  it("falls back to OpenAI when Claude fails or refuses", async () => {
    setKey("ANTHROPIC_API_KEY", "sk-ant-test");
    setKey("OPENAI_API_KEY", "sk-test");
    const openai = { status: 200, json: { choices: [{ message: { content: '{"title":"Hang a TV"}' } }] } };
    let calls = fakeFetch([{ status: 529, json: {} }, openai]);
    expect(await readPasteWithModel("hang a tv", "2026-11-23", { allowModel: true })).toEqual({ title: "Hang a TV" });
    expect(calls[1].url).toBe("https://api.openai.com/v1/chat/completions");
    calls = fakeFetch([claude("", "refusal"), openai]);
    expect(await readPasteWithModel("hang a tv", "2026-11-23", { allowModel: true })).toEqual({ title: "Hang a TV" });
    expect(calls.length).toBe(2);
  });

  it("returns null when no service answers", async () => {
    setKey("ANTHROPIC_API_KEY", "sk-ant-test");
    setKey("OPENAI_API_KEY", undefined);
    fakeFetch([{ status: 500, json: {} }]);
    expect(await readPasteWithModel("hang a tv", "2026-11-23", { allowModel: true })).toBeNull();
    setKey("ANTHROPIC_API_KEY", undefined);
    expect(await readPasteWithModel("hang a tv", "2026-11-23", { allowModel: true })).toBeNull();
  });
});
