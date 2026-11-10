import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getRepository } from "@/lib/db/index";
import { sendEmailNow } from "@/lib/email";
import { appUrl } from "@/lib/format";

/** Reset emails to one address: 5 an hour, so nobody can flood a customer's inbox. */
const PER_EMAIL = { bucket: "reset-email", max: 5, windowMs: 60 * 60 * 1000 };

/**
 * Where the emailed reset link points. A preview build links to itself so it
 * can be tested before going live; everywhere else it is the site's address.
 */
export function resetOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const preview = (env.VERCEL_ENV === "preview" && env.VERCEL_URL ? env.VERCEL_URL : "").trim();
  if (preview) return `https://${preview.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return appUrl(env);
}

export function resetLink(tokenHash: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${resetOrigin(env)}/reset/open?token_hash=${encodeURIComponent(tokenHash)}`;
}

/** Subject carries the time so a mail app shows each request as its own email instead of folding repeats. */
export function resetSubject(now = new Date()): string {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: "America/Detroit", hour: "numeric", minute: "2-digit" }).format(now);
  return `Reset your eX Construction password (${time})`;
}

export function resetBody(link: string): string {
  return [
    "Someone asked to reset the password for your eX Construction account.",
    "",
    "Open this link and tap \"Set a new password\":",
    "",
    link,
    "",
    "The link works once, in any browser. If you asked more than once, only the newest email works.",
    "",
    "If you didn't ask for this, ignore this email and your password stays the same.",
  ].join("\n");
}

/**
 * Send our own reset email through Resend. The link carries a one-time token
 * that isn't tied to the browser that asked, so it opens anywhere.
 * "sent": on its way. "skip": no such account, or too many for this address
 * (the caller still gives the neutral reply). "failed": fall back to Supabase's mailer.
 * The link is never stored in the email queue.
 */
export async function sendResetEmail(email: string): Promise<"sent" | "skip" | "failed"> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return "failed";
  try {
    const limit = await getRepository().hitRateLimit(PER_EMAIL.bucket, email, PER_EMAIL.max, PER_EMAIL.windowMs);
    if (!limit.allowed) return "skip";
  } catch (error) {
    console.error("[auth] reset email limit check failed", error);
  }
  try {
    const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.generateLink({ type: "recovery", email });
    if (error) {
      if (error.status === 404 || /not found/i.test(error.message)) return "skip";
      console.error("[auth] reset link could not be made", error.message);
      return "failed";
    }
    const tokenHash = data.properties?.hashed_token;
    if (!tokenHash) return "failed";
    const ok = await sendEmailNow({ to: email, subject: resetSubject(), body: resetBody(resetLink(tokenHash)) });
    return ok ? "sent" : "failed";
  } catch (error) {
    console.error("[auth] reset email failed", error);
    return "failed";
  }
}
