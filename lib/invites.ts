import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Crew invites. The owner types a phone number or an email; the person gets a link and
 * sets up their own sign-in. Nothing is stored for an invite: the link itself carries
 * who it is for and when it runs out, signed so it can't be made up or changed.
 * It works once, because the crew member it creates takes the invite's own id.
 */
export const INVITE_DAYS = 3;

export type CrewInvite = {
  /** Becomes the crew member's id, which is what makes the link single-use. */
  id: string;
  crewId: string | null;
  /** Filled when the invite went to an email address. */
  email: string;
  /** Ten digits, filled when the invite went to a phone number. */
  phone: string;
  /** When the link stops working, in milliseconds. */
  expires: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The signing key. On the live site it comes from a server-only secret that never reaches a browser. */
export function inviteSecret(env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.CREW_INVITE_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  // No secret only happens on the saved-file demo on a computer, never on the public site.
  return createHash("sha256").update(`crew-invite:${base || "saved-file-demo"}`).digest("hex");
}

function seal(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("base64url").slice(0, 32);
}

export function signInvite(invite: CrewInvite, secret: string = inviteSecret()): string {
  const body = Buffer.from(JSON.stringify([invite.id, invite.crewId ?? "", invite.email, invite.phone, Math.floor(invite.expires / 1000)])).toString("base64url");
  return `${body}.${seal(body, secret)}`;
}

/** The invite inside a link, or null when the link is incomplete, changed, or past its date. */
export function readInvite(token: string | null | undefined, now: number = Date.now(), secret: string = inviteSecret()): CrewInvite | null {
  const [body, mark, extra] = (token ?? "").trim().split(".");
  if (!body || !mark || extra !== undefined) return null;
  const expected = Buffer.from(seal(body, secret));
  const given = Buffer.from(mark);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!Array.isArray(parsed) || parsed.length !== 5) return null;
    const [id, crewId, email, phone, seconds] = parsed as unknown[];
    if (typeof id !== "string" || !UUID.test(id)) return null;
    if (typeof crewId !== "string" || (crewId !== "" && !UUID.test(crewId))) return null;
    if (typeof email !== "string" || typeof phone !== "string" || typeof seconds !== "number") return null;
    const expires = seconds * 1000;
    if (!Number.isFinite(expires) || expires <= now) return null;
    return { id, crewId: crewId || null, email, phone, expires };
  } catch {
    return null;
  }
}

export type InviteContact = { ok: true; email: string; phone: string } | { ok: false; error: string };

/** What the owner typed: an email address, or a US phone number in any common shape. */
export function parseInviteContact(text: string): InviteContact {
  const value = text.trim();
  if (!value) return { ok: false, error: "Type their phone number or their email." };
  if (value.includes("@")) {
    if (!EMAIL.test(value) || value.length > 200) return { ok: false, error: "That email doesn't look right. Check it and try again." };
    return { ok: true, email: value.toLowerCase(), phone: "" };
  }
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (digits.length !== 10) return { ok: false, error: "A phone number needs 10 digits, area code first. Or type their email instead." };
  return { ok: true, email: "", phone: digits };
}

/** (231) 555-0123 */
export function prettyPhone(digits: string): string {
  return digits.length === 10 ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` : digits;
}

export function inviteLink(token: string, origin: string): string {
  return `${origin.replace(/\/$/, "")}/join?k=${encodeURIComponent(token)}`;
}

export const INVITE_EMAIL_SUBJECT = "Set up your eX Construction crew sign-in";

export function inviteEmailBody(link: string): string {
  return [
    "You've been invited to the eX Construction crew page.",
    "",
    "Open this link to set up your own sign-in:",
    "",
    link,
    "",
    "It takes a minute: your name, your email and a password you choose. After that you can see your jobs, add your hours and shop time, and turn in receipts.",
    "",
    `The link is good for ${INVITE_DAYS} days and works once. If you weren't expecting this, ignore this email.`,
  ].join("\n");
}

/** What goes in front of the link when the owner texts it from their own phone. */
export const INVITE_TEXT = `eX Construction crew: set up your own sign-in here (good for ${INVITE_DAYS} days):`;
