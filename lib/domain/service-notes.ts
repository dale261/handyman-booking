import type { ServiceId } from "./types";

/**
 * Phrases that belong to one listed service. A note that hits another
 * service, and not the one the customer picked, is left off the quote.
 * Generic notes (price, cleanup, site surprises) hit none of these and stay.
 */
const SERVICE_MARKERS: Record<ServiceId, RegExp | null> = {
  paint: /\b(paint|painting|repaint|primer)\b/i,
  tv: /\b(tv|television|hdmi)\b|\bmounting bracket\b|\btv mount\b|\bwall studs\b|\bstud finding\b|\bcord cover\b/i,
  blinds: /\b(blinds?|curtains?|drapes?|window treatments?)\b/i,
  furniture: /\b(assembl\w*|ikea|flat[- ]pack)\b/i,
  yard: /\b(yard|lawn|leaf removal|mulch)\b/i,
  clean: /\b(deep clean|housekeep|vacuum|mop)\b/i,
  helper: /\b(hire a helper|helpers?)\b/i,
  other: null,
};

export function noteFitsService(service: ServiceId, note: string): boolean {
  const text = note.trim();
  if (!text) return false;
  const hits = (Object.keys(SERVICE_MARKERS) as ServiceId[]).filter((id) => SERVICE_MARKERS[id]?.test(text));
  if (hits.length === 0) return true;
  return hits.includes(service);
}

/** Rate-sheet assumptions stay. AI lines that describe a different service are removed. */
export function mergeListedAssumptions(
  service: ServiceId,
  rateAssumptions: string[],
  ai: { scopeHint: string | null; assumptions: string[] },
): string[] {
  const notes = [...rateAssumptions];
  const hint = ai.scopeHint?.trim() ?? "";
  if (hint && noteFitsService(service, hint)) notes.unshift(`From your description: ${hint}`);
  for (const note of ai.assumptions) {
    const trimmed = note.trim();
    if (trimmed && noteFitsService(service, trimmed)) notes.push(trimmed);
  }
  return notes;
}
