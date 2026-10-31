import "server-only";
import { randomBytes } from "node:crypto";

/**
 * Reset tokens for the saved-file demo on Dale's computer, where there is no
 * Supabase Auth to email a link. Kept in memory: a restart simply voids them.
 * The live site never uses this; Supabase sends its own recovery link.
 */
const tokens = new Map<string, { userId: string; expires: number }>();
const TTL_MS = 60 * 60 * 1000;

export function issueLocalResetToken(userId: string): string {
  for (const [key, value] of tokens) if (value.expires < Date.now()) tokens.delete(key);
  const token = randomBytes(24).toString("hex");
  tokens.set(token, { userId, expires: Date.now() + TTL_MS });
  return token;
}

/** Returns the user id once, then the token is gone. */
export function consumeLocalResetToken(token: string): string | null {
  const found = tokens.get(token);
  if (!found) return null;
  tokens.delete(token);
  if (found.expires < Date.now()) return null;
  return found.userId;
}

export function peekLocalResetToken(token: string): string | null {
  const found = tokens.get(token);
  if (!found || found.expires < Date.now()) return null;
  return found.userId;
}
