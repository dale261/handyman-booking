import { clamp, num } from "./money";
import { cleanWallsText } from "./paint";
import { DEFAULT_PARAMS, PREAPPROVED, type QuoteParams, type ServiceId } from "./types";

/**
 * A quote a visitor built before creating an account: the service, its
 * answers, the job ZIP, and a short description. It rides in a cookie from
 * the public price page to sign-up, then becomes a real quote.
 */
export type QuoteDraft = {
  service: ServiceId;
  params: QuoteParams;
  /** Street address of the job, so travel is measured to the real door. */
  address: string;
  zip: string;
  description: string;
  urgent: boolean;
  pickup: boolean;
  /** Who is asking. A name and phone are required before any price is shown. */
  fullName: string;
  phone: string;
  email: string;
  /** The saved lead, once the price has been shown. Linked to the job when they book. */
  leadId: string | null;
};

export const DRAFT_COOKIE = "ex_quote_draft";
/** One day. Long enough to come back and finish, short enough to forget a stale price. */
export const DRAFT_MAX_AGE_SECONDS = 60 * 60 * 24;
export const DESCRIPTION_MIN = 8;
export const DESCRIPTION_MAX = 1000;
export const ADDRESS_MIN = 5;
export const ADDRESS_MAX = 160;

/** The job site as one line ending in the ZIP, the way a quote stores it. */
export function jobSiteAddress(draft: Pick<QuoteDraft, "address" | "zip">): string {
  const address = draft.address.trim().replace(/[,\s]+$/, "");
  return address.endsWith(draft.zip) ? address : `${address} ${draft.zip}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Digits only, for matching the same person across price checks. */
export function phoneDigits(phone: string): string {
  return phone.replace(/\D/g, "");
}

const ENUMS = {
  height: ["8", "9", "11"],
  cond: ["good", "fair", "poor"],
  tvSize: ["55", "75", "85"],
  wall: ["drywall", "plaster", "brick"],
  conceal: ["none", "raceway", "lowvolt", "power"],
  itemKind: ["small", "medium", "large"],
  blindKind: ["blinds", "curtains"],
} as const;

const RANGES: Partial<Record<keyof QuoteParams, [number, number]>> = {
  rooms: [1, 50],
  // 0 means "not given": the quote then prices from the wall lengths or floor area it saved.
  roomLength: [0, 200],
  roomWidth: [0, 200],
  sqft: [1, 20000],
  doors: [0, 200],
  colors: [1, 20],
  items: [1, 50],
  hours: [0.5, 24],
  helpers: [1, 10],
  materials: [0, 100000],
  windows: [1, 100],
};

function pick<K extends keyof typeof ENUMS>(key: K, value: unknown): QuoteParams[K] {
  const allowed = ENUMS[key] as readonly string[];
  const chosen = allowed.includes(String(value)) ? String(value) : (DEFAULT_PARAMS[key] as string);
  return chosen as unknown as QuoteParams[K];
}

/** Coerce anything shaped like quote answers into a safe QuoteParams. Unknown keys are dropped. */
export function sanitizeParams(input: unknown): QuoteParams {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const numberAt = (key: keyof QuoteParams) => {
    const fallback = DEFAULT_PARAMS[key] as number;
    const range = RANGES[key] ?? [0, Number.MAX_SAFE_INTEGER];
    return clamp(num(src[key], fallback), range[0], range[1]);
  };
  return {
    rooms: numberAt("rooms"),
    // Missing keys mean an older draft that priced from wall lengths or floor area; 0 keeps that path.
    roomLength: src.roomLength == null ? 0 : numberAt("roomLength"),
    roomWidth: src.roomWidth == null ? 0 : numberAt("roomWidth"),
    walls: cleanWallsText(src.walls),
    sqft: numberAt("sqft"),
    height: pick("height", src.height),
    cond: pick("cond", src.cond),
    doors: numberAt("doors"),
    colors: numberAt("colors"),
    ceilings: src.ceilings === true,
    pre1978: src.pre1978 === true,
    tvSize: pick("tvSize", src.tvSize),
    wall: pick("wall", src.wall),
    conceal: pick("conceal", src.conceal),
    items: numberAt("items"),
    itemKind: pick("itemKind", src.itemKind),
    hours: numberAt("hours"),
    haul: src.haul === true,
    deep: src.deep === true,
    helpers: numberAt("helpers"),
    materials: numberAt("materials"),
    windows: numberAt("windows"),
    blindKind: pick("blindKind", src.blindKind),
  };
}

export type DraftParse = { ok: true; draft: QuoteDraft } | { ok: false; error: string };

/**
 * Validate a draft from a form, a server action argument, or the cookie.
 * Only listed services can be priced without an account; "Something else" needs one.
 */
export function parseDraft(raw: unknown): DraftParse {
  let src: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return { ok: false, error: "Start the quote again." };
      src = parsed as Record<string, unknown>;
    } catch {
      return { ok: false, error: "Start the quote again." };
    }
  } else if (raw && typeof raw === "object") {
    src = raw as Record<string, unknown>;
  } else {
    return { ok: false, error: "Start the quote again." };
  }

  const service = String(src.service ?? "");
  if (service === "other") {
    return { ok: false, error: "Other jobs are priced from your description after you create an account." };
  }
  if (!PREAPPROVED.includes(service as ServiceId)) return { ok: false, error: "Pick a service." };

  const address = String(src.address ?? "").trim().replace(/\s+/g, " ").slice(0, ADDRESS_MAX);
  if (address.length < ADDRESS_MIN) return { ok: false, error: "Add the street address where the work is." };
  const zip = String(src.zip ?? "").trim();
  if (!/^\d{5}$/.test(zip)) return { ok: false, error: "Enter the 5-digit ZIP where the work is." };

  const description = String(src.description ?? "").trim();
  if (description.length < DESCRIPTION_MIN) return { ok: false, error: "Describe the job in a sentence or two." };
  if (description.length > DESCRIPTION_MAX) return { ok: false, error: `Keep the description under ${DESCRIPTION_MAX} characters.` };

  const fullName = String(src.fullName ?? "").trim().slice(0, 80);
  if (fullName.length < 2) return { ok: false, error: "Add your name so we know who to call." };
  const phone = String(src.phone ?? "").trim().slice(0, 30);
  if (phoneDigits(phone).length < 7) return { ok: false, error: "Add a phone number we can reach you at." };
  const email = String(src.email ?? "").trim().toLowerCase().slice(0, 120);
  if (email && !EMAIL.test(email)) return { ok: false, error: "That email doesn't look right. Fix it or leave it blank." };
  const leadId = typeof src.leadId === "string" && UUID.test(src.leadId) ? src.leadId : null;

  const helper = service === "helper";
  return {
    ok: true,
    draft: {
      service: service as ServiceId,
      params: sanitizeParams(src.params),
      address,
      zip,
      description,
      urgent: !helper && src.urgent === true,
      pickup: !helper && src.pickup === true,
      fullName,
      phone,
      email,
      leadId,
    },
  };
}

export function serializeDraft(draft: QuoteDraft): string {
  return JSON.stringify(draft);
}
