import { describe, expect, it } from "vitest";
import { parseDraft, phoneDigits, sanitizeParams, serializeDraft } from "./draft";
import { DEFAULT_PARAMS } from "./types";

describe("quote draft", () => {
  it("accepts a listed service with a ZIP and a description", () => {
    const parsed = parseDraft({
      service: "tv",
      params: { tvSize: "75", wall: "plaster", conceal: "raceway" },
      zip: "49601",
      description: "Mount a 65-inch TV in the living room",
      urgent: true,
      pickup: false,
      fullName: "Jane Doe",
      phone: "(231) 555-0100",
      email: "Jane@Example.com",
      leadId: "not-a-uuid",
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.service).toBe("tv");
    expect(parsed.draft.params.tvSize).toBe("75");
    expect(parsed.draft.params.wall).toBe("plaster");
    expect(parsed.draft.params.rooms).toBe(DEFAULT_PARAMS.rooms);
    expect(parsed.draft.urgent).toBe(true);
    expect(parsed.draft.pickup).toBe(false);
    expect(parsed.draft.fullName).toBe("Jane Doe");
    expect(parsed.draft.email).toBe("jane@example.com");
    expect(parsed.draft.leadId).toBeNull();
  });

  it("needs a name and a phone before any price, and checks the email when given", () => {
    const base = { service: "tv", params: {}, zip: "49601", description: "Mount a 55-inch TV please" };
    expect(parseDraft({ ...base, phone: "231-555-0100" }).ok).toBe(false);
    expect(parseDraft({ ...base, fullName: "Jane", phone: "12" }).ok).toBe(false);
    expect(parseDraft({ ...base, fullName: "Jane", phone: "231-555-0100", email: "nope" }).ok).toBe(false);
    const fine = parseDraft({ ...base, fullName: "Jane", phone: "231-555-0100", email: "", leadId: "2d6a5d4e-6a1f-4a2b-9c3d-1e2f3a4b5c6d" });
    expect(fine.ok).toBe(true);
    if (!fine.ok) return;
    expect(fine.draft.email).toBe("");
    expect(fine.draft.leadId).toBe("2d6a5d4e-6a1f-4a2b-9c3d-1e2f3a4b5c6d");
    expect(phoneDigits(fine.draft.phone)).toBe("2315550100");
  });

  it("round-trips through the cookie string", () => {
    const parsed = parseDraft({ service: "blinds", params: { windows: 4 }, zip: "49684", description: "Four bedroom windows, blinds", fullName: "Sam", phone: "2315550100" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const again = parseDraft(serializeDraft(parsed.draft));
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.draft).toEqual(parsed.draft);
  });

  it("sends 'Something else' to an account instead of pricing it", () => {
    const parsed = parseDraft({ service: "other", params: {}, zip: "49601", description: "Install 40 feet of baseboard", fullName: "Sam", phone: "2315550100" });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/create an account/);
  });

  it("rejects a bad service, ZIP, or description", () => {
    const who = { fullName: "Sam", phone: "2315550100" };
    expect(parseDraft({ ...who, service: "roof", params: {}, zip: "49601", description: "Replace the roof shingles" }).ok).toBe(false);
    expect(parseDraft({ ...who, service: "tv", params: {}, zip: "4960", description: "Mount a 55-inch TV please" }).ok).toBe(false);
    expect(parseDraft({ ...who, service: "tv", params: {}, zip: "49601", description: "TV" }).ok).toBe(false);
    expect(parseDraft("not json").ok).toBe(false);
    expect(parseDraft(null).ok).toBe(false);
  });

  it("ignores urgency and pickup for helpers", () => {
    const parsed = parseDraft({ service: "helper", params: { helpers: 2, hours: 4 }, zip: "49601", description: "Two helpers to move boxes", urgent: true, pickup: true, fullName: "Sam", phone: "2315550100" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.draft.urgent).toBe(false);
    expect(parsed.draft.pickup).toBe(false);
  });

  it("cleans up answers: strings become numbers, bad choices fall back, ranges are clamped", () => {
    const params = sanitizeParams({ rooms: "3", sqft: -20, height: "20", cond: "poor", ceilings: "yes", helpers: 99, hours: "2.5" });
    expect(params.rooms).toBe(3);
    expect(params.sqft).toBe(1);
    expect(params.height).toBe(DEFAULT_PARAMS.height);
    expect(params.cond).toBe("poor");
    expect(params.ceilings).toBe(false);
    expect(params.helpers).toBe(10);
    expect(params.hours).toBe(2.5);
    expect(params.tvSize).toBe(DEFAULT_PARAMS.tvSize);
  });
});
