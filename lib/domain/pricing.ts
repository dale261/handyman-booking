import { clamp, num, roundCents } from "./money";
import type { QuoteLine, QuoteParams, QuoteResult, ServiceId, Settings } from "./types";

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
    return { now: safe, later: 0, rule: `Under $${line.toLocaleString("en-US")}: full payment due to confirm` };
  }
  const cents = Math.round(safe * 100);
  const nowCents = Math.floor(cents / 2);
  const laterCents = cents - nowCents;
  const now = nowCents / 100;
  const later = laterCents / 100;
  const rule =
    safe === line
      ? `Exactly $${line.toLocaleString("en-US")} counts as $${line.toLocaleString("en-US")} or more: 50% down to confirm, balance at completion`
      : `$${line.toLocaleString("en-US")} or more: 50% down to confirm, balance at completion`;
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
    const heightLabel = p.height === "11" ? "vaulted/11 ft+" : `${p.height} ft`;
    scope = `Paint walls in ${rooms} room(s), about ${sq} sq ft of floor area, ${heightLabel} ceilings, ${p.cond} wall condition`;
    lines.push(
      line(
        "Walls",
        `${sq} sq ft × $${r.paintSqft} × height ${hm} × condition ${cm}`,
        sq * r.paintSqft * hm * cm,
        "service",
      ),
    );
    if (p.ceilings) {
      lines.push(line("Ceilings", `${sq} sq ft × $${r.paintCeiling}`, sq * r.paintCeiling, "service"));
    }
    const doors = Math.max(0, num(p.doors, 0));
    if (doors > 0) lines.push(line("Trim and doors", `${doors} × $${r.paintDoor}`, doors * r.paintDoor, "service"));
    const colors = Math.max(0, num(p.colors, 1));
    if (colors > 2) {
      lines.push(line("Extra colors", `${colors - 2} beyond 2 × $${r.paintColor}`, (colors - 2) * r.paintColor, "service"));
    }
    assumptions.push(
      "Premium paint, 2 coats, included",
      "Furniture moved and covered, floors protected, daily cleanup",
      p.cond === "good" ? "Walls need only light prep" : "Patching and sanding for the stated wall condition included",
    );
    if (p.pre1978) {
      assumptions.push(
        "Pre-1978 home: if prep disturbs paint above EPA's small-area limits, lead-safe (RRP) practices and EPA certification apply",
      );
    }
  } else if (id === "tv") {
    const base = p.tvSize === "85" ? r.tvLarge : p.tvSize === "75" ? r.tvMid : r.tvSmall;
    const sizeLabel = p.tvSize === "85" ? "76 in.+" : p.tvSize === "75" ? "56–75 in." : "up to 55 in.";
    scope = `Mount a ${sizeLabel} TV on ${p.wall}`;
    lines.push(line("Mounting", "Level, anchored into studs or masonry", base, "service"));
    if (p.wall === "brick") lines.push(line("Wall type", "Brick/stone anchors", r.tvBrick, "service"));
    if (p.wall === "plaster") lines.push(line("Wall type", "Plaster", r.tvPlaster, "service"));
    if (p.conceal === "raceway") lines.push(line("Cord cover", "Paintable surface raceway", r.tvRaceway, "service"));
    if (p.conceal === "lowvolt") {
      lines.push(line("Hide wires in wall", "Low-voltage cables only (HDMI, etc.)", r.tvConceal, "service"));
    }
    assumptions.push("Customer supplies the TV and mount (or we supply at cost)", "Includes stud finding, leveling and cleanup");
  } else if (id === "blinds") {
    const n = Math.max(1, Math.round(num(p.windows, 1)));
    const kind = p.blindKind === "curtains" ? "curtain set" : "blind set";
    scope = `Hang ${n} ${kind}${n === 1 ? "" : "s"}`;
    lines.push(line(p.blindKind === "curtains" ? "Curtains" : "Blinds", `${n} × $${r.blindsEach}`, n * r.blindsEach, "service"));
    assumptions.push("Standard windows", "Uses the hardware you have, or basic brackets we bring");
  } else if (id === "furniture") {
    const n = Math.max(1, Math.round(num(p.items, 1)));
    const each = p.itemKind === "large" ? r.asmLarge : p.itemKind === "small" ? r.asmSmall : r.asmMedium;
    scope = `Assemble ${n} ${p.itemKind} item(s)`;
    lines.push(line("Assembly", `${n} × $${each}`, n * each, "service"));
    assumptions.push("Packaging hauled away", "Anchoring tall furniture to the wall included");
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
        `${crew} × ${h} h × $${r.hourly}${mult > 1 ? ` × ${mult} deep clean` : ""}`,
        crew * h * r.hourly * mult,
        "service",
      ),
    );
    if (id === "yard" && p.haul) lines.push(line("Haul-away", "Yard waste disposal", r.haul, "service"));
    assumptions.push("Hours are an estimate from your description; billed as quoted unless the scope changes");
  } else if (id === "helper") {
    const n = clamp(Math.round(num(p.helpers, 1)), 1, r.helperMax);
    const h = clamp(num(p.hours, 1), 1, r.helperMaxHours);
    scope = `Hire a helper: ${n} person(s) for ${h} hours`;
    lines.push(line("Helpers", `${n} × ${h} h × $${r.helperRate}`, n * h * r.helperRate, "service"));
    assumptions.push(
      "Every helper is reserved for the full block plus travel",
      "Helpers do general labor only, not licensed trade work",
      "1-hour minimum",
    );
  } else {
    const h = Math.max(0, num(p.hours, 3));
    const m = Math.max(0, num(p.materials, 0));
    scope = `Custom job, about ${h} labor hours`;
    lines.push(line("Labor", `${h} h × $${r.hourly}`, h * r.hourly, "service"));
    if (m > 0) lines.push(line("Materials", "Estimated, at cost", m, "materials"));
    assumptions.push("Custom work: final scope confirmed by the owner");
  }

  const serviceSum = roundCents(lines.filter((l) => l.kind === "service").reduce((a, l) => a + l.amount, 0));
  if (isPremiumCounty(county, r)) {
    const pct = Math.round((r.premiumMultiplier - 1) * 100);
    const premium = roundCents(serviceSum * (r.premiumMultiplier - 1));
    if (premium !== 0) {
      lines.push(
        line(
          `Area premium +${pct}%`,
          `${county} County, on labor and service only (not travel)`,
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
      line("Minimum job charge", `Brings the job to $${r.minimumJob}`, roundCents(r.minimumJob - beforeTravel), "minimum"),
    );
  }

  const miles = oneWayMiles == null ? null : Math.max(0, oneWayMiles);
  const from = opts?.travelFrom || "the shop";
  if (miles == null) {
    lines.push(
      line(
        "Travel",
        `Minimum travel fee until road miles are measured from ${from}. $${r.mileRate}/mile, $${r.travelMinimum} minimum. Never added to the area premium.`,
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
        `From ${from}: ${roundCents(miles)} one-way road mi${estimate} × $${r.mileRate}/mi, $${r.travelMinimum} minimum${minHit ? " (minimum applies)" : ""}. Charged once for the crew. Not part of the area premium.`,
        fee,
        "travel",
      ),
    );
  }

  if (opts?.urgent && id !== "helper") {
    lines.push(line("Urgency", "Short-notice premium", r.urgency, "urgency"));
  }
  if (opts?.pickup && id !== "helper") {
    lines.push(line("Material pickup", "Pickup before the job", r.pickup, "pickup"));
  }

  assumptions.push("Price shown is a firm quote for the scope described; surprises found on site mean a revised quote");

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
