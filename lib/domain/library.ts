import { usd } from "@/lib/format";
import type { LibraryEntry, LibraryGroup } from "./library-data";
import { LIBRARY_SEED } from "./library-data";
import { roundCents } from "./money";
import { isPremiumCounty, splitPayment, travelFee } from "./pricing";
import type { QuoteLine, Settings } from "./types";

/** Labor is never priced below hourly × hours × this buffer. */
export const LABOR_BUFFER = 1.25;

export const CUSTOMER_PRICE_NOTE =
  "This price is an AI estimate based on your description and our local cost library. It uses the high end of those ranges. If the site differs from what you described, the price may need to change.";

const HOURLY_IDS = new Set(["electrician-labor", "plumber-labor"]);

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const VAGUE_RE = /\b(not sure|whatever|misc|and other stuff|unsure|don't know|do not know|dont know)\b/i;

export type LibrarySelection = {
  items: { id: string; quantity: number }[];
  estimatedHours: number;
  materials: number;
  confidence: "high" | "low";
  vague: boolean;
};

export type QuoteMetaItem = {
  id: string;
  name: string;
  unit: string;
  quantity: number;
  unitLow: number;
  unitHigh: number;
  amount: number;
  basis: "local" | "national";
  discount: number;
  group: LibraryGroup;
};

export type QuoteMeta = {
  kind: "library" | "hourly_fallback";
  bookable: boolean;
  confidence: "high" | "low" | "none";
  reasoning: string;
  math: string[];
  items: QuoteMetaItem[];
  librarySum: number;
  laborFloor: number;
  materials: number;
  floor: number;
  rangeLow: number;
  rangeHigh: number;
  referralEstimate: number | null;
  reviewReasons: string[];
  estimatedHours: number;
  selection: LibrarySelection;
};

export type PriceUnlistedInput = {
  items: { id: string; quantity: number }[];
  estimatedHours: number;
  materials: number;
  confidence: unknown;
  vague: unknown;
  reasoning?: string;
  assumptions?: string[];
  zip: string;
  county: string;
  settings: Settings;
  library?: LibraryEntry[];
  miles: number | null;
  travelFrom?: string;
  milesAreEstimate?: boolean;
  urgent?: boolean;
  pickup?: boolean;
};

export type PricedUnlisted = {
  scope: string;
  lines: QuoteLine[];
  assumptions: string[];
  total: number;
  quoteMeta: QuoteMeta;
};

export function nationalFactor(zip: string): number {
  const digits = zip.replace(/\D/g, "");
  if (digits.startsWith("496")) return 0.96;
  if (digits.startsWith("497")) return 0.95;
  return 1;
}

export function unitRange(
  entry: LibraryEntry,
  zip: string,
): { low: number; high: number; basis: "local" | "national"; discount: number } | null {
  if (entry.localLow != null && entry.localHigh != null) {
    return {
      low: roundCents(entry.localLow),
      high: roundCents(entry.localHigh),
      basis: "local",
      discount: 0,
    };
  }
  if (entry.nationalLow == null || entry.nationalHigh == null) return null;
  const factor = nationalFactor(zip);
  return {
    low: roundCents(entry.nationalLow * factor),
    high: roundCents(entry.nationalHigh * factor),
    basis: "national",
    discount: roundCents(1 - factor),
  };
}

function line(label: string, detail: string, amount: number, kind: QuoteLine["kind"]): QuoteLine {
  return { label, detail, amount: roundCents(amount), kind };
}

function clampQty(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(100000, n);
}

function keywordPattern(keyword: string): RegExp {
  const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}(?:es|s)?\\b`, "i");
}

function matchesKeyword(text: string, keyword: string): boolean {
  return keywordPattern(keyword).test(text);
}

function numberToken(token: string): number | null {
  const word = WORD_NUMBERS[token.toLowerCase()];
  if (word) return word;
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

function quantityFor(text: string, entry: LibraryEntry): number {
  const unit = entry.unit.toLowerCase();
  if (entry.id !== "roof-asphalt" && (unit.includes("sq ft") || unit.startsWith("per sq"))) {
    const sq = text.match(/(\d+(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|square\s+feet|sqft)\b/i);
    if (sq) return clampQty(Number(sq[1]));
  }
  if (unit.includes("lin")) {
    const lin = text.match(/(\d+(?:\.\d+)?)\s*(?:linear\s+feet|linear\s+ft\.?|lin\.?\s*ft\.?|feet|ft)\b/i);
    if (lin) return clampQty(Number(lin[1]));
  }
  if (entry.id === "roof-asphalt") {
    const squares = text.match(/(\d+(?:\.\d+)?)\s*squares?\b/i);
    if (squares) return clampQty(Number(squares[1]));
  }
  for (const keyword of entry.keywords) {
    const escaped = keyword.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp(
      `\\b(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\\b(?:\\s+\\w+){0,4}\\s+${escaped}(?:es|s)?\\b`,
      "i",
    );
    const match = text.match(re);
    if (!match) continue;
    const n = numberToken(match[1]);
    if (n && n > 0) return clampQty(n);
  }
  return 1;
}

export function explicitHours(text: string): number | null {
  const match = text.match(/\b(\d+(?:\.\d+)?)\s*hours?\b/i);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0 || n > 200) return null;
  return n;
}

export function guessHours(entry: LibraryEntry, qty: number): number {
  const unit = entry.unit.toLowerCase();
  if (unit.includes("hour")) return qty;
  if (unit.includes("lin")) return Math.max(2, qty * 0.08);
  if (entry.id === "roof-asphalt") return Math.max(4, qty * 2);
  if (unit.includes("sq ft") || unit.startsWith("per sq")) return Math.max(2, qty * 0.05);
  if (entry.id.includes("patch")) return Math.max(1.5, qty * 1.5);
  if (/door|lock|fixture|outlet|window|faucet|toilet/.test(entry.id)) return Math.max(1, qty * 1.5);
  return Math.max(2, qty * 2);
}

function hoursFor(description: string, items: { entry: LibraryEntry; quantity: number }[]): number {
  const stated = explicitHours(description);
  if (stated != null) return stated;
  if (items.length === 0) return 3;
  return roundCents(items.reduce((sum, item) => sum + guessHours(item.entry, item.quantity), 0));
}

function normalizeConfidence(value: unknown): "high" | "low" {
  return value === "high" ? "high" : "low";
}

function normalizeVague(value: unknown): boolean {
  if (value === false) return false;
  if (value === true) return true;
  return true;
}

function normalizeHours(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 200) return null;
  return n;
}

function normalizeMaterials(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return roundCents(n);
}

export function keywordMatch(description: string, library: LibraryEntry[] = LIBRARY_SEED): LibrarySelection & { reasoning: string } {
  const text = description.trim();
  const short = text.length < 12;
  const vaguePhrase = VAGUE_RE.test(text);
  const hits: { entry: LibraryEntry; quantity: number }[] = [];
  for (const entry of library) {
    if (entry.keywords.some((keyword) => matchesKeyword(text, keyword))) {
      hits.push({ entry, quantity: quantityFor(text, entry) });
    }
  }
  const suppressed = new Set(hits.flatMap((hit) => hit.entry.suppressIds));
  const specificGroups = new Set(hits.filter((hit) => !HOURLY_IDS.has(hit.entry.id)).map((hit) => hit.entry.group));
  const kept = hits.filter((hit) => {
    if (suppressed.has(hit.entry.id)) return false;
    if (HOURLY_IDS.has(hit.entry.id) && specificGroups.has(hit.entry.group)) return false;
    return true;
  });
  const noMatch = kept.length === 0;
  const vague = short || vaguePhrase || noMatch;
  const names = kept.map((hit) => hit.entry.name);
  return {
    items: kept.map((hit) => ({ id: hit.entry.id, quantity: hit.quantity })),
    estimatedHours: hoursFor(text, kept),
    materials: 0,
    confidence: vague ? "low" : "high",
    vague,
    reasoning: noMatch
      ? "No library entry matched the description, so this uses the hourly labor floor."
      : `Matched ${names.join(", ")} from the description.`,
  };
}

export function interpretUnlistedModel(
  raw: unknown,
  library: LibraryEntry[],
  description: string,
): { selection: LibrarySelection; reasoning: string; assumptions: string[]; licenseConcern: string | null } {
  const byId = new Map(library.map((entry) => [entry.id, entry]));
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const dropped: string[] = [];
  const items: { id: string; quantity: number }[] = [];
  if (Array.isArray(body.items)) {
    for (const item of body.items) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = typeof row.id === "string" ? row.id.trim() : "";
      if (!byId.has(id)) {
        if (id) dropped.push(id);
        continue;
      }
      const quantity = typeof row.quantity === "number" ? row.quantity : Number(row.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) continue;
      items.push({ id, quantity });
    }
  }
  const guessed = keywordMatch(description, library);
  const hours = normalizeHours(body.estimatedHours) ?? guessed.estimatedHours;
  const materials = normalizeMaterials(body.materials);
  const confidence = normalizeConfidence(body.confidence);
  const vague = normalizeVague(body.vague);
  const reasoningRaw = typeof body.reasoning === "string" ? body.reasoning.trim() : "";
  const reasoning = (reasoningRaw || guessed.reasoning).slice(0, 2000);
  const assumptions = Array.isArray(body.assumptions)
    ? body.assumptions.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
    : [];
  const licenseConcern =
    typeof body.licenseConcern === "string" && body.licenseConcern.trim() ? body.licenseConcern.trim().slice(0, 500) : null;
  return {
    selection: {
      items,
      estimatedHours: hours,
      materials,
      confidence: vague ? "low" : confidence,
      vague,
    },
    reasoning: dropped.length ? `${reasoning} Ignored unknown library ids: ${dropped.join(", ")}.` : reasoning,
    assumptions,
    licenseConcern,
  };
}

function travelLine(miles: number | null, settings: Settings, from: string, estimate: boolean): QuoteLine {
  if (miles == null) {
    return line(
      "Travel",
      `Minimum travel fee until road miles are measured from ${from}. $${settings.mileRate}/mile, $${settings.travelMinimum} minimum. Never added to the area premium.`,
      settings.travelMinimum,
      "travel",
    );
  }
  const fee = travelFee(miles, settings.mileRate, settings.travelMinimum);
  const minHit = miles * settings.mileRate < settings.travelMinimum;
  const estimated = estimate ? " (estimated)" : "";
  return line(
    "Travel",
    `From ${from}: ${roundCents(miles)} one-way road mi${estimated} × $${settings.mileRate}/mi, $${settings.travelMinimum} minimum${minHit ? " (minimum applies)" : ""}. Charged once for the crew. Not part of the area premium.`,
    fee,
    "travel",
  );
}

function stackExtras(
  lines: QuoteLine[],
  settings: Settings,
  county: string,
  miles: number | null,
  from: string,
  estimate: boolean,
  urgent: boolean,
  pickup: boolean,
  math: string[],
): QuoteLine[] {
  const next = [...lines];
  const serviceSum = roundCents(next.filter((item) => item.kind === "service").reduce((sum, item) => sum + item.amount, 0));
  if (isPremiumCounty(county, settings)) {
    const pct = Math.round((settings.premiumMultiplier - 1) * 100);
    const premium = roundCents(serviceSum * (settings.premiumMultiplier - 1));
    if (premium !== 0) {
      next.push(
        line(
          `Area premium +${pct}%`,
          `${county} County, on labor and service only (not travel)`,
          premium,
          "premium",
        ),
      );
      math.push(`Area premium +${pct}% on ${usd(serviceSum)} of labor and service = ${usd(premium)}. Travel is not marked up.`);
    }
  } else {
    math.push(`No area premium in ${county || "this"} County.`);
  }

  const beforeTravel = roundCents(
    next.filter((item) => item.kind === "service" || item.kind === "premium" || item.kind === "materials").reduce((sum, item) => sum + item.amount, 0),
  );
  if (beforeTravel < settings.minimumJob) {
    const topUp = roundCents(settings.minimumJob - beforeTravel);
    next.push(line("Minimum job charge", `Brings the job to $${settings.minimumJob} before travel`, topUp, "minimum"));
    math.push(`Minimum job charge adds ${usd(topUp)} so the work is at least ${usd(settings.minimumJob)} before travel.`);
  }

  next.push(travelLine(miles, settings, from, estimate));
  const travelAmount = next[next.length - 1].amount;
  math.push(`Travel ${usd(travelAmount)}.`);

  if (urgent) {
    next.push(line("Urgency", "Short-notice premium", settings.urgency, "urgency"));
    math.push(`Urgency ${usd(settings.urgency)}.`);
  }
  if (pickup) {
    next.push(line("Material pickup", "Pickup before the job", settings.pickup, "pickup"));
    math.push(`Material pickup ${usd(settings.pickup)}.`);
  }
  return next;
}

function lowTotal(
  service: number,
  materials: number,
  settings: Settings,
  county: string,
  miles: number | null,
  urgent: boolean,
  pickup: boolean,
): number {
  let sum = roundCents(service);
  if (isPremiumCounty(county, settings)) {
    sum = roundCents(sum + service * (settings.premiumMultiplier - 1));
  }
  sum = roundCents(sum + materials);
  if (sum < settings.minimumJob) sum = roundCents(settings.minimumJob);
  const fee = miles == null ? roundCents(settings.travelMinimum) : travelFee(miles, settings.mileRate, settings.travelMinimum);
  sum = roundCents(sum + fee);
  if (urgent) sum = roundCents(sum + settings.urgency);
  if (pickup) sum = roundCents(sum + settings.pickup);
  return sum;
}

export function priceUnlisted(input: PriceUnlistedInput): PricedUnlisted {
  const library = input.library ?? LIBRARY_SEED;
  const byId = new Map(library.map((entry) => [entry.id, entry]));
  const confidence = normalizeConfidence(input.confidence);
  const vague = normalizeVague(input.vague);
  const hours = normalizeHours(input.estimatedHours) ?? 0;
  const materials = normalizeMaterials(input.materials);
  const math: string[] = [];
  const reviewReasons: string[] = [];

  const merged = new Map<string, number>();
  for (const item of input.items) {
    if (!item || typeof item.id !== "string" || !byId.has(item.id)) continue;
    const quantity = typeof item.quantity === "number" ? item.quantity : Number(item.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100000) continue;
    merged.set(item.id, (merged.get(item.id) ?? 0) + quantity);
  }

  const priced: QuoteMetaItem[] = [];
  for (const [id, quantity] of merged) {
    const entry = byId.get(id);
    if (!entry) continue;
    const range = unitRange(entry, input.zip);
    if (!range) continue;
    const amount = roundCents(range.high * quantity);
    priced.push({
      id: entry.id,
      name: entry.name,
      unit: entry.unit,
      quantity,
      unitLow: range.low,
      unitHigh: range.high,
      amount,
      basis: range.basis,
      discount: range.discount,
      group: entry.group,
    });
    const discountNote =
      range.basis === "local"
        ? "local Michigan range, no ZIP discount"
        : range.discount > 0
          ? `national high ${usd(entry.nationalHigh ?? range.high)} minus ${Math.round(range.discount * 100)}% for ZIP ${input.zip.replace(/\D/g, "").slice(0, 3)}`
          : "national range";
    math.push(`${entry.name}: ${quantity} × ${usd(range.high)} high (${discountNote}) = ${usd(amount)}.`);
  }

  const librarySum = roundCents(priced.reduce((sum, item) => sum + item.amount, 0));
  const laborFloor = roundCents(input.settings.hourly * hours * LABOR_BUFFER);
  const floor = roundCents(laborFloor + materials);
  math.push(
    `Labor floor: ${usd(input.settings.hourly)} per hour × ${hours} h × ${LABOR_BUFFER} = ${usd(laborFloor)}.`,
  );
  if (priced.length) {
    math.push(`Estimated materials ${usd(materials)} sit in the floor only. Installed library prices already include materials.`);
    math.push(`Floor = labor floor + materials = ${usd(floor)}. Library high total = ${usd(librarySum)}.`);
  }

  const lines: QuoteLine[] = [];
  let serviceForLow = 0;
  let materialsForLow = 0;

  if (priced.length === 0) {
    reviewReasons.push("No library entry fits");
    const labor = laborFloor;
    lines.push(line("Labor", `${hours} h × ${usd(input.settings.hourly)} × ${LABOR_BUFFER} buffer`, labor, "service"));
    serviceForLow = roundCents(input.settings.hourly * hours);
    if (materials > 0) {
      lines.push(line("Materials", "Estimated, at cost. Not marked up by the area premium.", materials, "materials"));
      materialsForLow = materials;
    }
    math.push(`No library line fit, so the quote is the labor floor${materials > 0 ? " plus materials at cost" : ""}.`);
  } else {
    for (const item of priced) {
      lines.push(
        line(
          item.name,
          `${item.quantity} × ${usd(item.unitHigh)} high end, ${item.basis === "local" ? "local range" : item.discount > 0 ? `national minus ${Math.round(item.discount * 100)}%` : "national range"}`,
          item.amount,
          "service",
        ),
      );
    }
    serviceForLow = roundCents(priced.reduce((sum, item) => sum + item.unitLow * item.quantity, 0));
    if (floor > librarySum) {
      const topUp = roundCents(floor - librarySum);
      lines.push(
        line(
          "Profit floor",
          `Labor floor ${usd(floor)} is above the library high of ${usd(librarySum)}`,
          topUp,
          "service",
        ),
      );
      math.push(`The labor floor is higher, so a profit floor of ${usd(topUp)} is added. The quoted work price is ${usd(floor)}.`);
    } else {
      math.push(`The library high of ${usd(librarySum)} is at or above the labor floor of ${usd(floor)}, so the library price stands.`);
    }
    for (const item of priced) {
      const entry = byId.get(item.id);
      if (entry && !entry.performs) reviewReasons.push(`Refer out: ${entry.name}`);
    }
    const buildSum = roundCents(priced.filter((item) => item.group === "build").reduce((sum, item) => sum + item.amount, 0));
    if (buildSum >= input.settings.builderThreshold) {
      reviewReasons.push(
        `Builder-scope work is ${usd(buildSum)} before the area premium, which is at or above the ${usd(input.settings.builderThreshold)} builder threshold.`,
      );
    }
  }

  if (confidence !== "high") reviewReasons.push("Low confidence");
  if (vague) reviewReasons.push("Vague scope");

  const stacked = stackExtras(
    lines,
    input.settings,
    input.county,
    input.miles,
    input.travelFrom || "the shop",
    Boolean(input.milesAreEstimate),
    Boolean(input.urgent),
    Boolean(input.pickup),
    math,
  );
  const total = roundCents(stacked.reduce((sum, item) => sum + item.amount, 0));
  const rangeLow = lowTotal(
    serviceForLow,
    materialsForLow,
    input.settings,
    input.county,
    input.miles,
    Boolean(input.urgent),
    Boolean(input.pickup),
  );
  const bookable = reviewReasons.length === 0;
  math.push(
    bookable
      ? `Quoted ${usd(total)}, the higher of the library high and the labor floor, then premium, minimum, and travel.`
      : `Estimate ${usd(total)} is saved for the owner. The customer cannot book it until it is reviewed (${reviewReasons.join("; ")}).`,
  );

  const names = priced.map((item) => item.name);
  const scope = priced.length
    ? `AI estimate: ${names.join(", ")}`
    : `AI estimate: about ${hours} labor hours (no matching library price)`;

  const assumptions = [CUSTOMER_PRICE_NOTE, ...(input.assumptions ?? []).filter(Boolean).slice(0, 8)];
  if (bookable) assumptions.push("You can book and pay this price now.");
  else assumptions.push("Dale reviews this estimate before anyone can book or pay it.");

  const selection: LibrarySelection = {
    items: priced.length ? priced.map((item) => ({ id: item.id, quantity: item.quantity })) : [],
    estimatedHours: hours,
    materials,
    confidence: vague ? "low" : confidence,
    vague,
  };

  return {
    scope,
    lines: stacked,
    assumptions,
    total,
    quoteMeta: {
      kind: priced.length ? "library" : "hourly_fallback",
      bookable,
      confidence: priced.length ? selection.confidence : "none",
      reasoning: (input.reasoning || "").slice(0, 2000),
      math,
      items: priced,
      librarySum,
      laborFloor,
      materials,
      floor,
      rangeLow,
      rangeHigh: total,
      referralEstimate: bookable ? null : total,
      reviewReasons,
      estimatedHours: hours,
      selection,
    },
  };
}

export function isLibraryQuote(meta: QuoteMeta | null | undefined): meta is QuoteMeta {
  return meta?.kind === "library" || meta?.kind === "hourly_fallback";
}

/** Replace only the travel line and shift totals by the travel difference. Library unit prices stay put. */
export function pricedWithTravel(
  lines: QuoteLine[],
  meta: QuoteMeta,
  miles: number | null,
  fromLabel: string,
  settings: Settings,
  milesAreEstimate: boolean,
): { lines: QuoteLine[]; total: number; meta: QuoteMeta; travelFee: number } {
  const nextLines = lines.map((item) => ({ ...item }));
  const oldFee = nextLines.find((item) => item.kind === "travel")?.amount ?? 0;
  const travel = travelLine(miles, settings, fromLabel, milesAreEstimate);
  const index = nextLines.findIndex((item) => item.kind === "travel");
  if (index === -1) nextLines.push(travel);
  else nextLines[index] = travel;
  const delta = roundCents(travel.amount - oldFee);
  const total = roundCents(nextLines.reduce((sum, item) => sum + item.amount, 0));
  const split = splitPayment(total, settings.depositThreshold);
  return {
    lines: nextLines,
    total,
    travelFee: travel.amount,
    meta: {
      ...meta,
      rangeLow: roundCents(meta.rangeLow + delta),
      rangeHigh: roundCents(meta.rangeHigh + delta),
      referralEstimate: meta.referralEstimate == null ? null : roundCents(meta.referralEstimate + delta),
      math: meta.math.map((note) => (note.startsWith("Travel ") ? `Travel ${usd(travel.amount)}.` : note)),
    },
    ...{ dueNow: split.now, balance: split.later, payRule: split.rule, delta },
  };
}

export function libraryTravelSplit(total: number, settings: Settings) {
  return splitPayment(total, settings.depositThreshold);
}

function textOr(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function nullableNumber(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function mergeLibrary(saved: Partial<LibraryEntry>[] | null | undefined): LibraryEntry[] {
  const byId = new Map<string, Partial<LibraryEntry>>();
  for (const row of saved ?? []) {
    if (row && typeof row.id === "string") byId.set(row.id, row);
  }
  return LIBRARY_SEED.map((seed) => {
    const over = byId.get(seed.id);
    if (!over) return { ...seed, keywords: [...seed.keywords], suppressIds: [...seed.suppressIds] };
    return {
      ...seed,
      name: textOr(over.name, seed.name),
      unit: textOr(over.unit, seed.unit),
      nationalLow: nullableNumber(over.nationalLow, seed.nationalLow),
      nationalHigh: nullableNumber(over.nationalHigh, seed.nationalHigh),
      localLow: nullableNumber(over.localLow, seed.localLow),
      localHigh: nullableNumber(over.localHigh, seed.localHigh),
      source: textOr(over.source, seed.source),
      notes: over.notes == null ? seed.notes : String(over.notes),
      keywords: [...seed.keywords],
      performs: typeof over.performs === "boolean" ? over.performs : seed.performs,
      sortOrder: seed.sortOrder,
      group: seed.group,
      suppressIds: [...seed.suppressIds],
    };
  });
}

export function libraryByGroup(library: LibraryEntry[]): Record<LibraryGroup, LibraryEntry[]> {
  return {
    handy: library.filter((entry) => entry.group === "handy"),
    trades: library.filter((entry) => entry.group === "trades"),
    build: library.filter((entry) => entry.group === "build"),
  };
}
