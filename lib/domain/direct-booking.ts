import { PREAPPROVED, type ServiceId } from "./types";

/** Services the quote tool offers. Direct bookings are PREAPPROVED; "other" is reviewed. */
export function quoteToolServices(): ServiceId[] {
  const listed: ServiceId[] = [...PREAPPROVED];
  if (!listed.includes("other")) listed.push("other");
  return listed;
}

type BookableId = Exclude<ServiceId, "other">;

type Clause = { ids: readonly BookableId[]; text: string };

/**
 * Home-page wording. Membership comes from PREAPPROVED.
 * Hire a helper stays last. TV mounting and window coverings share one sentence.
 */
const CLAUSES: Clause[] = [
  { ids: ["paint"], text: "Painting, including large jobs" },
  { ids: ["clean"], text: "House cleaning" },
  { ids: ["yard"], text: "Yard cleanup" },
  { ids: ["tv", "blinds"], text: "TV mounting and window coverings" },
  { ids: ["furniture"], text: "Furniture assembly" },
  { ids: ["helper"], text: "Hire a helper" },
];

/** Used when a grouped sentence no longer matches the catalog, so a service cannot disappear. */
const SOLO: Record<BookableId, string> = {
  paint: "Painting, including large jobs",
  clean: "House cleaning",
  yard: "Yard cleanup",
  tv: "TV mounting",
  blinds: "Window coverings",
  furniture: "Furniture assembly",
  helper: "Hire a helper",
};

function isBookableId(id: ServiceId): id is BookableId {
  return id !== "other" && id in SOLO;
}

function partsFor(services: readonly ServiceId[]): { ids: BookableId[]; text: string }[] {
  const wanted = new Set(services.filter(isBookableId));
  const parts: { ids: BookableId[]; text: string }[] = [];
  const seen = new Set<BookableId>();
  for (const clause of CLAUSES) {
    if (clause.ids.includes("helper")) continue;
    if (!clause.ids.every((id) => wanted.has(id))) continue;
    parts.push({ ids: [...clause.ids], text: clause.text });
    clause.ids.forEach((id) => seen.add(id));
  }
  for (const id of services) {
    if (!isBookableId(id) || id === "helper" || !wanted.has(id) || seen.has(id)) continue;
    parts.push({ ids: [id], text: SOLO[id] });
    seen.add(id);
  }
  if (wanted.has("helper")) parts.push({ ids: ["helper"], text: SOLO.helper });
  return parts;
}

/** Directly bookable services named on the home card, Hire a helper last. */
export function directBookingServices(services: readonly ServiceId[] = PREAPPROVED): BookableId[] {
  return partsFor(services).flatMap((part) => part.ids);
}

/** One friendly sentence. Each directly bookable service is named once. */
export function directBookingBlurb(services: readonly ServiceId[] = PREAPPROVED): string {
  const parts = partsFor(services).map((part) => part.text);
  return parts.length === 0 ? "" : `${parts.join(". ")}.`;
}
