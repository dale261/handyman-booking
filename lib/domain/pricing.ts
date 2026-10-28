import { clamp, num, roundCents } from "./money";
import type { QuoteLine, QuoteParams, QuoteResult, ServiceId, Settings } from "./types";

function countNoun(n: number, one: string, many: string): string {
  const qty = Number.isInteger(n) ? String(n) : String(n);
  return `${qty} ${n === 1 ? one : many}`;
}

export type PaymentSplit = {
  now: number;
  later: number;
  rule: string;
};

/**
 * Under the threshold: pay in full. At or above it: 50% down.
 * The down payment is half the cents, rounded down, so the leftover cent
 * stays on the balance.
 */
export function splitPayment(total: number, threshold: number): PaymentSplit {
  const safe = roundCents(Math.max(0, num(total, 0)));
  const line = roundCents(Math.max(0, num(threshold, 1500)));
  if (safe < line) {
    return { now: safe, later: 0, rule: `Jobs under $${line.toLocaleString("en-US")} are paid in full to book.` };
  }
  const cents = Math.round(safe * 100);
  const nowCents = Math.floor(cents / 2);
  const laterCents = cents - nowCents;
  const now = nowCents / 100;
  const later = laterCents / 100;
  const rule =
    safe === line
      ? `A $${line.toLocaleString("en-US")} job requires half down to book. The rest is due after you approve the work.`
      : `Jobs of $${line.toLocaleString("en-US")} or more require half down to book. The rest is due after you approve the work.`;
  return { now, later, rule };
}

/** One-way road miles × rate, never under the per-job minimum. */
export function travelFee(oneWayMiles: number, perMile: number, minFee: number): number {
  const miles = Math.max(0, num(oneWayMiles, 0));
  const rate = Math.max(0, num(perMile, 0));
  const min = Math.max(0, num(minFee, 0));
  const raw = roundCents(miles * rate);
  return roundCents(Math.max(min, raw));
}

export function isPremiumCounty(county: string, settings: Pick<Settings, "premiumEnabled" | "premiumCounties">): boolean {
  if (!settings.premiumEnabled) return false;
  return settings.premiumCounties.some((c) => c.toLowerCase() === county.trim().toLowerCase());
}

function line(label: string, detail: string, amount: number, kind: QuoteLine["kind"]): QuoteLine {
  return { label, detail, amount: roundCents(amount), kind };
}

/**
 * Itemized quote from the owner's rate table.
 * Area premium applies to labor and service lines only (including helpers),
 * never to materials-at-cost, travel, pickup, or urgency.
 * The minimum job charge tops up labor, service, premium, and materials.
 * Travel is added after that.
 */
export function quoteCalc(
  id: ServiceId,
  p: QuoteParams,
  r: Settings,
  county: string,
  oneWayMiles: number | null,
  opts?: { urgent?: boolean; pickup?: boolean; travelFrom?: string; milesAreEstimate?: boolean },
): QuoteResult {
  const lines: QuoteLine[] = [];
  const assumptions: string[] = [];
  let scope = "";

  if (id === "paint") {
    const sq = Math.max(0, num(p.sqft, 0));
    const rooms = Math.max(0, num(p.rooms, 1));
    const hm = p.height === "11" ? r.height11 : p.height === "9" ? r.height9 : 1;
    const cm = p.cond === "poor" ? r.condPoor : p.cond === "fair" ? r.condFair : 1;
    const heightLabel = p.height === "11" ? "vaulted, 11 ft or taller" : `${p.height} ft`;
    scope = `Paint walls in ${countNoun(rooms, "room", "rooms")}, about ${sq} sq ft, ${heightLabel} ceilings, ${p.cond} walls`;
    lines.push(line("Walls", `${sq} sq ft, ${heightLabel} ceilings, ${p.cond} walls`, sq * r.paintSqft * hm * cm, "service"));
    if (p.ceilings) {
      lines.push(line("Ceilings", `${sq} sq ft of ceiling`, sq * r.paintCeiling, "service"));
    }
    const doors = Math.max(0, num(p.doors, 0));
    if (doors > 0) lines.push(line("Trim and doors", countNoun(doors, "piece", "pieces"), doors * r.paintDoor, "service"));
    const colors = Math.max(0, num(p.colors, 1));
    if (colors > 2) {
      lines.push(line("Extra colors", countNoun(colors - 2, "extra color", "extra colors"), (colors - 2) * r.paintColor, "service"));
    }
    assumptions.push(
      "Premium paint and 2 coats are included",
      "We move and cover furniture, protect the floors, and clean up",
      p.cond === "good" ? "The walls only need light prep" : "Patching and sanding for the wall condition you picked are included",
    );
    if (p.pre1978) {
      assumptions.push("This home was built before 1978. If prep disturbs more than a small area of paint, lead-safe work applies.");
    }
  } else if (id === "tv") {
    const base = p.tvSize === "85" ? r.tvLarge : p.tvSize === "75" ? r.tvMid : r.tvSmall;
    const sizeLabel = p.tvSize === "85" ? "76 in.+" : p.tvSize === "75" ? "56–75 in." : "up to 55 in.";
    scope = `Mount a TV, ${sizeLabel}, on ${p.wall}`;
    lines.push(line("Mounting", "Level, anchored into studs or masonry", base, "service"));
    if (p.wall === "brick") lines.push(line("Wall type", "Brick or stone anchors", r.tvBrick, "service"));
    if (p.wall === "plaster") lines.push(line("Wall type", "Plaster", r.tvPlaster, "service"));
    if (p.conceal === "raceway") lines.push(line("Cord cover", "A cover for the cords", r.tvRaceway, "service"));
    if (p.conceal === "lowvolt") {
      lines.push(line("Hide wires in wall", "Low-voltage cables only, such as HDMI", r.tvConceal, "service"));
    }
    assumptions.push("You supply the TV and the mount, unless we agree to bring them", "We find the studs, level the set, and clean up");
  } else if (id === "blinds") {
    const n = Math.max(1, Math.round(num(p.windows, 1)));
    const kind = p.blindKind === "curtains" ? "curtain set" : "blind set";
    scope = `Hang ${n} ${kind}${n === 1 ? "" : "s"}`;
    lines.push(line(p.blindKind === "curtains" ? "Curtains" : "Blinds", countNoun(n, "window", "windows"), n * r.blindsEach, "service"));
    assumptions.push("Standard windows", "We use the hardware you have, or basic brackets we bring");
  } else if (id === "furniture") {
    const n = Math.max(1, Math.round(num(p.items, 1)));
    const each = p.itemKind === "large" ? r.asmLarge : p.itemKind === "small" ? r.asmSmall : r.asmMedium;
    scope = `Assemble ${countNoun(n, `${p.itemKind} item`, `${p.itemKind} items`)}`;
    lines.push(line("Assembly", countNoun(n, "item", "items"), n * each, "service"));
    assumptions.push("We haul away the packaging", "Tall pieces are anchored to the wall");
  } else if (id === "yard" || id === "clean") {
    const h = Math.max(0, num(p.hours, 3));
    const crew = id === "yard" ? r.yardCrewSize : 1;
    const mult = id === "clean" && p.deep ? r.deepClean : 1;
    scope =
      id === "yard"
        ? `Yard cleanup, ${crew}-person crew, about ${h} hours`
        : `${p.deep ? "Deep" : "Routine"} household cleaning, about ${h} hours`;
    lines.push(
      line(
        "Labor",
        id === "yard"
          ? `${countNoun(crew, "person", "people")}, about ${h} hours`
          : `About ${h} hours${p.deep ? ", deep clean" : ""}`,
        crew * h * r.hourly * mult,
        "service",
      ),
    );
    if (id === "yard" && p.haul) lines.push(line("Haul-away", "Yard waste hauled away", r.haul, "service"));
    assumptions.push("The hours come from what you described. If the job is different on site, we'll talk with you before changing the price.");
  } else if (id === "helper") {
    const n = clamp(Math.round(num(p.helpers, 1)), 1, r.helperMax);
    const h = clamp(num(p.hours, 1), 1, r.helperMaxHours);
    scope = `Hire ${countNoun(n, "helper", "helpers")} for ${countNoun(h, "hour", "hours")}`;
    lines.push(line("Helpers", `${countNoun(n, "helper", "helpers")}, ${countNoun(h, "hour", "hours")}`, n * h * r.helperRate, "service"));
    assumptions.push(
      "Each helper is reserved for the full time, plus the drive",
      "Helpers do general labor, not licensed trade work",
      "There is a 1-hour minimum",
    );
  } else {
    const h = Math.max(0, num(p.hours, 3));
    const m = Math.max(0, num(p.materials, 0));
    scope = `Custom job, about ${h} hours of labor`;
    lines.push(line("Labor", `About ${h} hours on site`, h * r.hourly, "service"));
    if (m > 0) lines.push(line("Materials", "Materials for this job", m, "materials"));
    assumptions.push("Dale confirms the details before this is booked");
  }

  const serviceSum = roundCents(lines.filter((l) => l.kind === "service").reduce((a, l) => a + l.amount, 0));
  if (isPremiumCounty(county, r)) {
    const pct = Math.round((r.premiumMultiplier - 1) * 100);
    const premium = roundCents(serviceSum * (r.premiumMultiplier - 1));
    if (premium !== 0) {
      lines.push(
        line(
          `Area charge +${pct}%`,
          `${county} County. This is on the work, not the drive.`,
          premium,
          "premium",
        ),
      );
    }
  }

  const beforeTravel = roundCents(
    lines.filter((l) => l.kind === "service" || l.kind === "premium" || l.kind === "materials").reduce((a, l) => a + l.amount, 0),
  );
  if (beforeTravel < r.minimumJob) {
    lines.push(
      line("Minimum job charge", `Our smallest job is $${r.minimumJob}, before travel`, roundCents(r.minimumJob - beforeTravel), "minimum"),
    );
  }

  const miles = oneWayMiles == null ? null : Math.max(0, oneWayMiles);
  const from = opts?.travelFrom || "the shop";
  if (miles == null) {
    lines.push(
      line(
        "Travel",
        `Travel from ${from} until we measure the drive. $${r.mileRate} per mile, $${r.travelMinimum} minimum.`,
        r.travelMinimum,
        "travel",
      ),
    );
  } else {
    const fee = travelFee(miles, r.mileRate, r.travelMinimum);
    const minHit = miles * r.mileRate < r.travelMinimum;
    const estimate = opts?.milesAreEstimate ? " (estimated)" : "";
    lines.push(
      line(
        "Travel",
        `From ${from}: ${roundCents(miles)} miles one way${estimate}. $${r.mileRate} per mile, $${r.travelMinimum} minimum${minHit ? ". The minimum applies" : ""}.`,
        fee,
        "travel",
      ),
    );
  }

  if (opts?.urgent && id !== "helper") {
    lines.push(line("Short notice", "You asked for a sooner visit", r.urgency, "urgency"));
  }
  if (opts?.pickup && id !== "helper") {
    lines.push(line("Material pickup", "Pickup before the job", r.pickup, "pickup"));
  }

  assumptions.push("This quote matches what you described. If the job is different on site, we'll talk with you before changing the price.");

  const total = roundCents(lines.reduce((a, l) => a + l.amount, 0));
  return { scope, lines, assumptions, total };
}

/** Labor + materials + area premium. Used for the $600 builder-license screen. Excludes travel. */
export function licenseEstimate(result: QuoteResult): number {
  return roundCents(
    result.lines
      .filter((l) => l.kind === "service" || l.kind === "materials" || l.kind === "premium")
      .reduce((a, l) => a + l.amount, 0),
  );
}

export function crewNeeded(id: ServiceId, p: QuoteParams, r: Settings): number {
  if (id === "helper") return clamp(Math.round(num(p.helpers, 1)), 1, r.helperMax);
  if (id === "paint") return r.paintCrewSize;
  if (id === "yard") return r.yardCrewSize;
  return 1;
}

export function onsiteMinutes(id: ServiceId, p: QuoteParams, r: Settings): number {
  if (id === "helper") return Math.round(clamp(num(p.hours, 1), 1, r.helperMaxHours) * 60);
  if (id === "paint") {
    const rooms = Math.max(1, num(p.rooms, 1));
    const extra = Math.max(0, rooms - 1) * 90 + (p.ceilings ? 45 : 0);
    return Math.round(r.onsitePaint + extra);
  }
  if (id === "tv") return r.onsiteTv + (p.conceal === "none" ? 0 : 20);
  if (id === "blinds") return Math.round(r.onsiteBlinds + Math.max(0, num(p.windows, 1) - 1) * 20);
  if (id === "furniture") {
    const n = Math.max(1, num(p.items, 1));
    const each = p.itemKind === "large" ? 60 : p.itemKind === "small" ? 25 : 40;
    return Math.round(Math.max(r.onsiteFurniture, n * each));
  }
  if (id === "yard") return Math.round(Math.max(r.onsiteYard, num(p.hours, 2) * 60));
  if (id === "clean") return Math.round(Math.max(r.onsiteClean, num(p.hours, 2) * 60));
  return Math.round(Math.max(r.onsiteOther, num(p.hours, 2) * 60));
}
