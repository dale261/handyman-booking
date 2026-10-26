import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { areaCheck } from "./area";
import { refundBeforeWork, validateOwnerRefund } from "./cancellation";
import { DEFAULT_SETTINGS } from "./settings";
import { roundCents } from "./money";
import { licenseEstimate, quoteCalc, splitPayment, travelFee } from "./pricing";
import { classify } from "./screening";
import { chooseCrew, crewRoute, previousJob, visitWindow, workerFree } from "./scheduling";
import { billedMiles, fallbackRoadMiles, haversineMiles, roadMilesBetween } from "./travel";
import { DEFAULT_PARAMS, type QuoteParams, type Settings, type ZipRecord } from "./types";

const settings: Settings = { ...DEFAULT_SETTINGS, premiumCounties: [...DEFAULT_SETTINGS.premiumCounties] };

function params(patch: Partial<QuoteParams> = {}): QuoteParams {
  return { ...DEFAULT_PARAMS, ...patch };
}

describe("travel fee", () => {
  it("charges $1 per one-way mile with a $50 minimum", () => {
    expect(travelFee(10, 1, 50)).toBe(50);
    expect(travelFee(50, 1, 50)).toBe(50);
    expect(travelFee(80, 1, 50)).toBe(80);
    expect(travelFee(0, 1, 50)).toBe(50);
    expect(travelFee(-4, 1, 50)).toBe(50);
  });

  it("uses the owner's rate and minimum", () => {
    expect(travelFee(40, 2, 50)).toBe(80);
    expect(travelFee(10.4, 1.5, 0)).toBe(15.6);
  });
});

describe("deposit split", () => {
  it("charges in full under $1,500 and half at $1,500 or more", () => {
    expect(splitPayment(1499, 1500)).toEqual({
      now: 1499,
      later: 0,
      rule: "Under $1,500: full payment due to confirm",
    });
    expect(splitPayment(1499.99, 1500).later).toBe(0);
    const exact = splitPayment(1500, 1500);
    expect(exact.now).toBe(750);
    expect(exact.later).toBe(750);
    expect(exact.rule).toMatch(/Exactly \$1,500/);
    const over = splitPayment(2400, 1500);
    expect(over.now).toBe(1200);
    expect(over.later).toBe(1200);
  });

  it("puts the leftover cent on the balance", () => {
    const split = splitPayment(1500.01, 1500);
    expect(split.now).toBe(750);
    expect(split.later).toBe(750.01);
    expect(split.now + split.later).toBeCloseTo(1500.01, 2);
  });

  it("reads the threshold from settings", () => {
    expect(splitPayment(1800, 2000).later).toBe(0);
    expect(splitPayment(2000, 2000).now).toBe(1000);
  });
});

describe("quote pricing", () => {
  it("prices a helper job from the rate table and adds the area premium off of travel", () => {
    const quote = quoteCalc("helper", params({ helpers: 2, hours: 4 }), settings, "Leelanau", 80, {
      travelFrom: "the shop",
      urgent: true,
      pickup: true,
    });
    const helpers = quote.lines.find((l) => l.label === "Helpers");
    const premium = quote.lines.find((l) => l.kind === "premium");
    const travel = quote.lines.find((l) => l.kind === "travel");
    expect(helpers?.amount).toBe(800);
    expect(premium?.amount).toBe(160);
    expect(travel?.amount).toBe(80);
    expect(quote.lines.some((l) => l.kind === "urgency" || l.kind === "pickup")).toBe(false);
    expect(quote.total).toBe(1040);
  });

  it("never puts the area premium on a Wexford job", () => {
    const quote = quoteCalc("helper", params({ helpers: 2, hours: 4 }), settings, "Wexford", 10);
    expect(quote.lines.some((l) => l.kind === "premium")).toBe(false);
    expect(quote.lines.find((l) => l.kind === "travel")?.amount).toBe(50);
    expect(quote.total).toBe(850);
  });

  it("tops a one-hour helper up to the minimum, then adds travel", () => {
    const home = quoteCalc("helper", params({ helpers: 1, hours: 1 }), settings, "Wexford", 8);
    expect(home.lines.find((l) => l.kind === "service")?.amount).toBe(100);
    expect(home.lines.find((l) => l.kind === "minimum")?.amount).toBe(50);
    expect(home.lines.find((l) => l.kind === "travel")?.amount).toBe(50);
    expect(home.total).toBe(200);

    const north = quoteCalc("helper", params({ helpers: 1, hours: 1 }), settings, "Grand Traverse", 8);
    expect(north.lines.find((l) => l.kind === "premium")?.amount).toBe(20);
    expect(north.lines.find((l) => l.kind === "minimum")?.amount).toBe(30);
    expect(north.lines.find((l) => l.kind === "travel")?.amount).toBe(50);
    expect(north.total).toBe(200);
  });

  it("turns the premium off when the owner disables it", () => {
    const quote = quoteCalc(
      "helper",
      params({ helpers: 2, hours: 4 }),
      { ...settings, premiumEnabled: false },
      "Emmet",
      80,
    );
    expect(quote.lines.some((l) => l.kind === "premium")).toBe(false);
    expect(quote.total).toBe(880);
  });

  it("prices painting from floor area, height, condition, and keeps materials out of a labor-only job", () => {
    const quote = quoteCalc(
      "paint",
      params({ rooms: 1, sqft: 150, height: "9", cond: "fair", doors: 2, colors: 4, ceilings: true }),
      settings,
      "Charlevoix",
      60,
    );
    const walls = roundCents(150 * 6.5 * 1.15 * 1.1);
    expect(quote.lines.find((l) => l.label === "Walls")?.amount).toBe(walls);
    expect(quote.lines.find((l) => l.label === "Ceilings")?.amount).toBeCloseTo(150 * 1.75, 2);
    expect(quote.lines.find((l) => l.label === "Trim and doors")?.amount).toBe(150);
    expect(quote.lines.find((l) => l.label === "Extra colors")?.amount).toBe(120);
    const service = quote.lines.filter((l) => l.kind === "service").reduce((a, l) => a + l.amount, 0);
    expect(quote.lines.find((l) => l.kind === "premium")?.amount).toBeCloseTo(service * 0.2, 2);
    expect(quote.lines.find((l) => l.kind === "travel")?.amount).toBe(60);
  });

  it("adds urgency and pickup outside the premium", () => {
    const quote = quoteCalc("clean", params({ hours: 3, deep: false }), settings, "Leelanau", 40, {
      urgent: true,
      pickup: true,
    });
    expect(quote.lines.find((l) => l.kind === "service")?.amount).toBe(285);
    expect(quote.lines.find((l) => l.kind === "premium")?.amount).toBe(57);
    expect(quote.lines.find((l) => l.kind === "urgency")?.amount).toBe(50);
    expect(quote.lines.find((l) => l.kind === "pickup")?.amount).toBe(35);
    expect(quote.lines.find((l) => l.kind === "travel")?.amount).toBe(50);
    expect(quote.total).toBe(285 + 57 + 50 + 50 + 35);
  });

  it("does not premium materials billed at cost", () => {
    const quote = quoteCalc("other", params({ hours: 2, materials: 80 }), settings, "Emmet", 10);
    expect(quote.lines.find((l) => l.kind === "materials")?.amount).toBe(80);
    expect(quote.lines.find((l) => l.kind === "premium")?.amount).toBe(38);
  });
});

describe("license screening", () => {
  const est = (service: Parameters<typeof quoteCalc>[0], patch: Partial<QuoteParams>, county = "Wexford") =>
    licenseEstimate(quoteCalc(service, params(patch), settings, county, 10));

  it("lets pre-approved work through", () => {
    expect(classify("paint", "Repaint the living room and hallway", params(), est("paint", {}), settings).level).toBe("ok");
    expect(classify("helper", "Two helpers to move boxes", params(), 800, settings).level).toBe("ok");
    expect(classify("tv", "Mount a 55-inch TV on drywall", params(), 225, settings).level).toBe("ok");
    expect(classify("clean", "Routine kitchen and bath clean", params(), 200, settings).level).toBe("ok");
    expect(classify("blinds", "Hang curtains in the bedroom", params(), 85, settings).level).toBe("ok");
  });

  it("sends pre-1978 painting to the owner until RRP certified is on", () => {
    const off = classify("paint", "Repaint two bedrooms in our 1955 farmhouse", params({ pre1978: true }), 400, settings);
    expect(off.level).toBe("review");
    expect(off.trade).toMatch(/RRP/);
    const on = classify(
      "paint",
      "Repaint two bedrooms in our 1955 farmhouse",
      params({ pre1978: true }),
      400,
      { ...settings, rrpCertified: true },
    );
    expect(on.level).toBe("ok");
  });

  it("refers clear licensed trades and reviews possible minor repairs", () => {
    expect(classify("other", "Move an outlet and patch the drywall", params(), 200, settings).level).toBe("refer");
    expect(classify("other", "Replace two worn outlets with the same type", params(), 150, settings).level).toBe("review");
    expect(classify("tv", "Mount the TV", params({ conceal: "power" }), 225, settings).level).toBe("review");
    expect(classify("other", "Replace the bathroom sink faucet with one I bought", params(), 150, settings).level).toBe("review");
    expect(classify("other", "Repipe the kitchen", params(), 900, settings).level).toBe("refer");
    expect(classify("other", "Replace the furnace", params(), 500, settings).level).toBe("refer");
    expect(classify("other", "Scrape the popcorn ceiling", params(), 300, settings).level).toBe("review");
  });

  it("refers builder work at $600 or more and reviews it under that", () => {
    const big = est("other", { hours: 14, materials: 900 });
    expect(big).toBeGreaterThanOrEqual(600);
    expect(
      classify("other", "Repair the back deck: replace rotted boards and two joists", params({ hours: 14, materials: 900 }), big, settings).level,
    ).toBe("refer");
    const small = est("other", { hours: 1, materials: 0 });
    expect(small).toBeLessThan(600);
    expect(classify("other", "Replace one deck board", params({ hours: 1 }), small, settings).level).toBe("review");
  });

  it("reviews anything that is not on the pre-approved list", () => {
    expect(classify("other", "Hang a heavy mirror in the hall", params(), 100, settings).level).toBe("review");
  });
});

describe("cancellation", () => {
  it("keeps $50 and refunds the rest before work starts", () => {
    expect(refundBeforeWork(180, 50)).toMatchObject({ fee: 50, refund: 130 });
    expect(refundBeforeWork(50, 50)).toMatchObject({ fee: 50, refund: 0 });
    expect(refundBeforeWork(40, 50)).toMatchObject({ fee: 40, refund: 0 });
    expect(refundBeforeWork(50.01, 50)).toMatchObject({ fee: 50, refund: 0.01 });
    expect(refundBeforeWork(0, 50).refund).toBe(0);
  });

  it("makes the owner type a refund with no suggestion", () => {
    expect(validateOwnerRefund("", 180).ok).toBe(false);
    expect(validateOwnerRefund("   ", 180).ok).toBe(false);
    expect(validateOwnerRefund("-1", 180).ok).toBe(false);
    expect(validateOwnerRefund("180.01", 180).ok).toBe(false);
    expect(validateOwnerRefund("abc", 180).ok).toBe(false);
    expect(validateOwnerRefund("0", 180)).toMatchObject({ ok: true, refund: 0, kept: 180 });
    expect(validateOwnerRefund("75.5", 180)).toMatchObject({ ok: true, refund: 75.5, kept: 104.5 });
    expect(validateOwnerRefund("180", 180)).toMatchObject({ ok: true, refund: 180, kept: 0 });
  });
});

describe("crew assignment and travel lock", () => {
  it("picks the closest free crew and breaks a distance tie toward fewer jobs", () => {
    const choice = chooseCrew(
      [
        { crewId: "crew-far", distanceMiles: 22, jobCount: 0, freeMemberIds: ["a"] },
        { crewId: "crew-near", distanceMiles: 8, jobCount: 3, freeMemberIds: ["b"] },
      ],
      1,
    );
    expect(choice?.crewId).toBe("crew-near");

    const tie = chooseCrew(
      [
        { crewId: "crew-busy", distanceMiles: 10, jobCount: 2, freeMemberIds: ["a"] },
        { crewId: "crew-light", distanceMiles: 10, jobCount: 1, freeMemberIds: ["b"] },
      ],
      1,
    );
    expect(tie?.crewId).toBe("crew-light");
    expect(tie?.distanceTie).toBe(true);
  });

  it("borrows extra hands when one crew is short, and skips a slot that is short of people", () => {
    const borrowed = chooseCrew(
      [
        { crewId: "crew-1", distanceMiles: 5, jobCount: 0, freeMemberIds: ["a", "b"] },
        { crewId: "crew-2", distanceMiles: 9, jobCount: 0, freeMemberIds: ["c"] },
      ],
      3,
    );
    expect(borrowed?.crewId).toBe("crew-1");
    expect(borrowed?.memberIds).toEqual(["a", "b", "c"]);
    expect(borrowed?.borrowed).toBe(true);
    expect(chooseCrew([{ crewId: "crew-1", distanceMiles: 5, jobCount: 0, freeMemberIds: ["a"] }], 2)).toBeNull();
  });

  it("keeps a paid job's travel when the live leg changes", () => {
    expect(billedMiles(true, 14, 30)).toBe(14);
    expect(billedMiles(false, 14, 30)).toBe(30);
    const route = crewRoute([
      { id: "old", startMin: 480, label: "Paid", address: "Lake City", liveLegMiles: 20, travelLocked: true, lockedMiles: 14 },
      { id: "new", startMin: 720, label: "Held", address: "Manton", liveLegMiles: 9, travelLocked: false, lockedMiles: null },
    ]);
    expect(route.rows[0].billedMiles).toBe(14);
    expect(route.rows[0].drifted).toBe(true);
    expect(route.rows[0].fromLabel).toBe("Shop to job 1");
    expect(route.rows[1].billedMiles).toBe(9);
    expect(route.rows[1].locked).toBe(false);
  });

  it("measures each crew from its own previous job", () => {
    const jobs = [
      { id: "1", crewId: "c1", startMin: 480, status: "booked" },
      { id: "2", crewId: "c2", startMin: 500, status: "booked" },
      { id: "3", crewId: "c1", startMin: 700, status: "cancelled" },
    ];
    expect(previousJob(jobs, "c1", 600)?.id).toBe("1");
    expect(previousJob(jobs, "c2", 600)?.id).toBe("2");
    expect(previousJob(jobs, "c1", 400)).toBeNull();
  });

  it("keeps a worker free only when the whole visit fits their day", () => {
    const window = visitWindow(600, 30, 60, 15);
    expect(window).toEqual({ reserveStart: 555, reserveEnd: 705 });
    expect(workerFree({ dayStart: 480, dayEnd: 1020 }, [[480, 540]], window.reserveStart, window.reserveEnd)).toBe(true);
    expect(workerFree({ dayStart: 480, dayEnd: 1020 }, [[560, 580]], window.reserveStart, window.reserveEnd)).toBe(false);
    expect(workerFree({ dayStart: 600, dayEnd: 1020 }, [], window.reserveStart, window.reserveEnd)).toBe(false);
  });
});

describe("road miles", () => {
  it("falls back to straight-line distance times the road factor", () => {
    const shop = { lat: settings.shopLat, lng: settings.shopLng };
    const glen = { lat: 44.844693, lng: -85.96231 };
    const straight = haversineMiles(shop, glen);
    expect(straight).toBeGreaterThan(40);
    expect(straight).toBeLessThan(70);
    expect(fallbackRoadMiles(straight, 1.25)).toBeCloseTo(straight * 1.25, 2);
  });

  it("uses OSRM when it answers and straight-line when routing fails", async () => {
    const from = { lat: 44.26, lng: -85.4 };
    const to = { lat: 44.84, lng: -85.96 };
    const ok = await roadMilesBetween(from, to, {
      roadFactor: 1.25,
      osrmBase: "https://router.example",
      fetchImpl: async () =>
        new Response(JSON.stringify({ routes: [{ distance: 16093.44 }] }), { status: 200 }),
    });
    expect(ok.source).toBe("osrm");
    expect(ok.miles).toBeCloseTo(10, 2);

    const failed = await roadMilesBetween(from, to, {
      roadFactor: 1.25,
      osrmBase: "https://router.example",
      orsKey: "test",
      fetchImpl: async () => new Response("nope", { status: 500 }),
    });
    expect(failed.source).toBe("straight-line");
    expect(failed.miles).toBeGreaterThan(0);
  });
});

describe("service area table", () => {
  const zips = JSON.parse(fs.readFileSync(path.join(process.cwd(), "data/zips.json"), "utf8")) as ZipRecord[];

  it("seeds all 161 ZIPs and books inside 231 with no distance limit", () => {
    expect(zips).toHaveLength(161);
    expect(zips.filter((z) => z.status === "auto_book")).toHaveLength(127);
    const glen = areaCheck("12 Sample Rd, Glen Arbor, MI 49636", zips);
    expect(glen.auto).toBe(true);
    expect(glen.county).toBe("Leelanau");
    expect(glen.milesFromCadillac).toBe(49.4);
    const petoskey = areaCheck("49770", zips);
    expect(petoskey.auto).toBe(true);
    expect(petoskey.county).toBe("Emmet");
    const edge = areaCheck("5 Sample Ln, Howard City, MI 49329", zips);
    expect(edge.auto).toBe(false);
    expect(edge.inTable).toBe(true);
    const outside = areaCheck("40 Example St, Grand Rapids, MI 49503", zips);
    expect(outside.auto).toBe(false);
    expect(outside.inTable).toBe(false);
    const po = areaCheck("49413", zips);
    expect(po.auto).toBe(false);
    expect(po.detail).toMatch(/PO box/i);
    expect(areaCheck("no zip yet", zips).found).toBe(false);
  });
});
