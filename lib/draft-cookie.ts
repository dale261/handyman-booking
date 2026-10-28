import "server-only";
import { cookies } from "next/headers";
import { DRAFT_COOKIE, DRAFT_MAX_AGE_SECONDS, parseDraft, serializeDraft, type QuoteDraft } from "@/lib/domain/draft";

/** The quote a visitor built before signing up, if the cookie is present and still valid. */
export async function readDraftCookie(): Promise<QuoteDraft | null> {
  const jar = await cookies();
  const raw = jar.get(DRAFT_COOKIE)?.value;
  if (!raw) return null;
  const parsed = parseDraft(raw);
  return parsed.ok ? parsed.draft : null;
}

export async function writeDraftCookie(draft: QuoteDraft): Promise<void> {
  const jar = await cookies();
  jar.set(DRAFT_COOKIE, serializeDraft(draft), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: DRAFT_MAX_AGE_SECONDS,
  });
}

export async function clearDraftCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(DRAFT_COOKIE);
}
