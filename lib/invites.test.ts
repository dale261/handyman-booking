import { describe, expect, it } from "vitest";
import { inviteEmailBody, inviteLink, inviteSecret, parseInviteContact, prettyPhone, readInvite, signInvite, type CrewInvite } from "@/lib/invites";

const SECRET = "test-secret";
const NOW = Date.UTC(2026, 10, 21, 22, 0, 0);
const invite: CrewInvite = {
  id: "11111111-2222-4333-8444-555555555555",
  crewId: "00000000-0000-4000-8000-0000000000c1",
  email: "",
  phone: "2315550123",
  expires: NOW + 3 * 24 * 60 * 60 * 1000,
};

describe("crew invite links", () => {
  it("carry the invite and read back the same", () => {
    const token = signInvite(invite, SECRET);
    expect(readInvite(token, NOW, SECRET)).toEqual(invite);
    const byEmail = { ...invite, crewId: null, email: "lexi@example.com", phone: "" };
    expect(readInvite(signInvite(byEmail, SECRET), NOW, SECRET)).toEqual(byEmail);
  });

  it("stop working after their date", () => {
    const token = signInvite(invite, SECRET);
    expect(readInvite(token, invite.expires - 1000, SECRET)).toEqual(invite);
    expect(readInvite(token, invite.expires + 1, SECRET)).toBe(null);
  });

  it("can't be changed or made up", () => {
    const token = signInvite(invite, SECRET);
    const [body, mark] = token.split(".");
    // Someone edits the crew, or moves the date out, and keeps the old signature.
    const forged = Buffer.from(JSON.stringify([invite.id, "", "", invite.phone, Math.floor(invite.expires / 1000) + 999999])).toString("base64url");
    expect(readInvite(`${forged}.${mark}`, NOW, SECRET)).toBe(null);
    expect(readInvite(`${body}.${mark.slice(0, -1)}x`, NOW, SECRET)).toBe(null);
    expect(readInvite(body, NOW, SECRET)).toBe(null);
    expect(readInvite(`${token}.extra`, NOW, SECRET)).toBe(null);
    expect(readInvite("", NOW, SECRET)).toBe(null);
    expect(readInvite(undefined, NOW, SECRET)).toBe(null);
    expect(readInvite("not.a-real-link", NOW, SECRET)).toBe(null);
    // Signed with a different key: another site's link doesn't work here.
    expect(readInvite(signInvite(invite, "other-secret"), NOW, SECRET)).toBe(null);
  });

  it("refuse a well-signed link with the wrong shape inside", () => {
    const bad = { ...invite, id: "not-an-id" };
    expect(readInvite(signInvite(bad, SECRET), NOW, SECRET)).toBe(null);
  });

  it("use a key that comes from the server's secret and differs per site", () => {
    const a = inviteSecret({ SUPABASE_SERVICE_ROLE_KEY: "aaa" } as unknown as NodeJS.ProcessEnv);
    const b = inviteSecret({ SUPABASE_SERVICE_ROLE_KEY: "bbb" } as unknown as NodeJS.ProcessEnv);
    expect(a).not.toBe(b);
    expect(a).not.toContain("aaa");
    expect(a).toHaveLength(64);
  });
});

describe("what the owner types", () => {
  it("reads a phone number in any common shape", () => {
    for (const text of ["231-555-0123", "(231) 555-0123", "2315550123", "+1 231 555 0123", "1-231-555-0123"]) {
      expect(parseInviteContact(text)).toEqual({ ok: true, email: "", phone: "2315550123" });
    }
    expect(prettyPhone("2315550123")).toBe("(231) 555-0123");
  });

  it("reads an email", () => {
    expect(parseInviteContact("  Lexi@Example.com ")).toEqual({ ok: true, email: "lexi@example.com", phone: "" });
  });

  it("says what is wrong otherwise", () => {
    expect(parseInviteContact("").ok).toBe(false);
    expect(parseInviteContact("555-0123").ok).toBe(false);
    expect(parseInviteContact("lexi@").ok).toBe(false);
    expect(parseInviteContact("Lexi").ok).toBe(false);
  });
});

describe("the invite message", () => {
  it("links to the join page and never needs the customer site's name spelled another way", () => {
    const link = inviteLink("abc.def", "https://example.test/");
    expect(link).toBe("https://example.test/join?k=abc.def");
    expect(inviteEmailBody(link)).toContain(link);
    expect(inviteEmailBody(link)).toContain("works once");
  });
});
