import { describe, expect, it } from "vitest";
import { LIBRARY_SEED } from "./library-data";
import {
  CUSTOMER_PRICE_NOTE,
  interpretUnlistedModel,
  keywordMatch,
  mergeLibrary,
  priceUnlisted,
  pricedWithTravel,
  unitRange,
} from "./library";
import { DEFAULT_SETTINGS } from "./settings";
import type { Settings } from "./types";

const settings = DEFAULT_SETTINGS;

function price(
  patch: Partial<Parameters<typeof priceUnlisted>[0]>,
) {
  return priceUnlisted({
    items: [],
    estimatedHours: 0,
    materials: 0,
    confidence: "high",
    vague: false,
    zip: "49601",
    county: "Wexford",
    settings,
    miles: 10,
    travelFrom: "the shop",
    ...patch,
  });
}

describe("cost library pricing", () => {
  it("keeps Dale's rate-sheet defaults and seeds 37 jobs", () => {
    expect(settings.hourly).toBe(95);
    expect(settings.aiDailyCap).toBe(100);
    expect(settings.aiCustomerDailyCap).toBe(10);
    expect(settings.paintWallSqft).toBe(2);
    expect(settings.helperRate).toBe(100);
    expect(settings.mileRate).toBe(1);
    expect(settings.travelMinimum).toBe(50);
    expect(settings.minimumJob).toBe(150);
    expect(settings.premiumMultiplier).toBe(1.2);
    expect(LIBRARY_SEED).toHaveLength(37);
    expect(LIBRARY_SEED.filter((entry) => entry.group === "handy").every((entry) => entry.performs)).toBe(true);
    expect(LIBRARY_SEED.filter((entry) => entry.group === "trades").every((entry) => !entry.performs)).toBe(true);
    expect(LIBRARY_SEED.filter((entry) => entry.group === "build").every((entry) => !entry.performs)).toBe(true);
  });

  it("charges the high end, then the labor floor when that is higher", () => {
    const quote = price({
      items: [{ id: "shelving", quantity: 1 }],
      estimatedHours: 8,
      zip: "49601",
      county: "Wexford",
      miles: 10,
    });
    expect(quote.quoteMeta.items[0].unitHigh).toBe(480);
    expect(quote.quoteMeta.librarySum).toBe(480);
    expect(quote.quoteMeta.laborFloor).toBe(950);
    expect(quote.lines.some((line) => line.label === "Time on the job" && line.amount === 470)).toBe(true);
    expect(quote.lines.some((line) => line.kind === "premium")).toBe(false);
    expect(quote.lines.find((line) => line.kind === "travel")?.amount).toBe(50);
    expect(quote.total).toBe(1000);
    expect(quote.quoteMeta.bookable).toBe(true);
    expect(quote.quoteMeta.referralEstimate).toBeNull();
    expect(quote.assumptions[0]).toBe(CUSTOMER_PRICE_NOTE);
  });

  it("stacks the area premium on the floor and leaves travel alone", () => {
    const quote = price({
      items: [{ id: "shelving", quantity: 1 }],
      estimatedHours: 8,
      zip: "49636",
      county: "Leelanau",
      miles: 80,
    });
    expect(quote.lines.find((line) => line.kind === "premium")?.amount).toBe(190);
    expect(quote.lines.find((line) => line.kind === "travel")?.amount).toBe(80);
    expect(quote.total).toBe(1220);
    expect(quote.lines.filter((line) => line.kind === "service").reduce((sum, line) => sum + line.amount, 0)).toBe(950);
  });

  it("keeps the library price when it already clears the floor", () => {
    const home = price({
      items: [{ id: "baseboard", quantity: 40 }],
      estimatedHours: 2,
      zip: "49601",
      county: "Wexford",
      miles: 10,
    });
    expect(home.quoteMeta.librarySum).toBe(345.6);
    expect(home.quoteMeta.laborFloor).toBe(237.5);
    expect(home.lines.some((line) => line.label === "Time on the job")).toBe(false);
    expect(home.total).toBe(395.6);

    const north = price({
      items: [{ id: "baseboard", quantity: 40 }],
      estimatedHours: 2,
      zip: "49770",
      county: "Emmet",
      miles: 10,
    });
    expect(north.quoteMeta.items[0].unitHigh).toBe(8.55);
    expect(north.quoteMeta.librarySum).toBe(342);
    expect(north.lines.find((line) => line.kind === "premium")?.amount).toBe(68.4);
    expect(north.total).toBe(460.4);
  });

  it("never prices below the job minimum", () => {
    const quote = price({
      items: [{ id: "caulking", quantity: 1 }],
      estimatedHours: 0,
      zip: "49601",
      county: "Wexford",
      miles: 10,
    });
    expect(quote.quoteMeta.librarySum).toBe(3.84);
    expect(quote.lines.find((line) => line.kind === "minimum")?.amount).toBe(146.16);
    expect(quote.lines.find((line) => line.kind === "travel")?.amount).toBe(50);
    expect(quote.total).toBe(200);
    const beforeTravel = quote.lines
      .filter((line) => line.kind !== "travel")
      .reduce((sum, line) => sum + line.amount, 0);
    expect(beforeTravel).toBe(150);
  });

  it("sends low confidence and vague scope to review without dropping the price", () => {
    const low = price({
      items: [{ id: "shelving", quantity: 1 }],
      estimatedHours: 8,
      confidence: "medium",
      vague: false,
    });
    expect(low.total).toBe(1000);
    expect(low.quoteMeta.bookable).toBe(false);
    expect(low.quoteMeta.reviewReasons).toContain("Low confidence");
    expect(low.quoteMeta.referralEstimate).toBe(1000);

    const vague = price({
      items: [{ id: "baseboard", quantity: 40 }],
      estimatedHours: 2,
      confidence: "high",
      vague: true,
    });
    expect(vague.total).toBe(395.6);
    expect(vague.quoteMeta.bookable).toBe(false);
    expect(vague.quoteMeta.reviewReasons).toContain("Vague scope");
    expect(vague.quoteMeta.reviewReasons).not.toContain("Low confidence");
  });

  it("refers out trades, and a builder job at the threshold, until the toggle says we do it", () => {
    const outlet = price({
      items: [{ id: "outlet", quantity: 1 }],
      estimatedHours: 2,
      zip: "49601",
      county: "Wexford",
      miles: 10,
    });
    expect(outlet.quoteMeta.librarySum).toBe(432);
    expect(outlet.quoteMeta.rangeLow).toBe(200);
    expect(outlet.total).toBe(482);
    expect(outlet.quoteMeta.rangeHigh).toBe(482);
    expect(outlet.quoteMeta.bookable).toBe(false);
    expect(outlet.quoteMeta.reviewReasons.some((reason) => /refer out/i.test(reason))).toBe(true);
    expect(outlet.quoteMeta.referralEstimate).toBe(482);

    const shelvingOff = price({
      items: [{ id: "shelving", quantity: 1 }],
      estimatedHours: 1,
      library: LIBRARY_SEED.map((entry) => (entry.id === "shelving" ? { ...entry, performs: false } : entry)),
    });
    expect(shelvingOff.quoteMeta.bookable).toBe(false);
    expect(shelvingOff.quoteMeta.reviewReasons.some((reason) => /refer out/i.test(reason))).toBe(true);

    const shelvingOn = price({
      items: [{ id: "shelving", quantity: 1 }],
      estimatedHours: 1,
      confidence: "high",
      vague: false,
    });
    expect(shelvingOn.quoteMeta.bookable).toBe(true);

    const deck = price({
      items: [{ id: "new-deck", quantity: 10 }],
      estimatedHours: 2,
      confidence: "high",
      vague: false,
      library: LIBRARY_SEED.map((entry) => (entry.id === "new-deck" ? { ...entry, performs: true } : entry)),
    });
    expect(deck.quoteMeta.librarySum).toBe(1000);
    expect(deck.quoteMeta.bookable).toBe(false);
    expect(deck.quoteMeta.reviewReasons.some((reason) => reason.includes("$600") || reason.includes("600"))).toBe(true);

    const smallDeck = price({
      items: [{ id: "new-deck", quantity: 4 }],
      estimatedHours: 2,
      library: LIBRARY_SEED.map((entry) => (entry.id === "new-deck" ? { ...entry, performs: true } : entry)),
    });
    expect(smallDeck.quoteMeta.librarySum).toBe(400);
    expect(smallDeck.quoteMeta.bookable).toBe(true);
  });

  it("uses the local roof high and falls back to the hourly floor when nothing matches", () => {
    const roof = unitRange(LIBRARY_SEED.find((entry) => entry.id === "roof-asphalt")!, "49601");
    expect(roof).toEqual({ low: 320, high: 750, basis: "local", discount: 0 });

    const quote = price({
      items: [],
      estimatedHours: 4,
      materials: 20,
      zip: "49601",
      county: "Wexford",
      miles: 10,
    });
    expect(quote.quoteMeta.kind).toBe("hourly_fallback");
    expect(quote.quoteMeta.laborFloor).toBe(475);
    expect(quote.lines.find((line) => line.kind === "materials")?.amount).toBe(20);
    expect(quote.lines.some((line) => line.kind === "premium")).toBe(false);
    expect(quote.total).toBe(545);
    expect(quote.quoteMeta.bookable).toBe(false);
    expect(quote.quoteMeta.reviewReasons).toContain("No library entry fits");
    expect(quote.quoteMeta.rangeLow).toBe(450);
  });

  it("matches keywords, quantities, and vague wording without taking a model price", () => {
    const baseboard = keywordMatch("Install 40 feet of baseboard in the hallway");
    expect(baseboard.items).toEqual([{ id: "baseboard", quantity: 40 }]);
    expect(baseboard.confidence).toBe("high");
    expect(baseboard.vague).toBe(false);

    const outlets = keywordMatch("Replace two outlets in the kitchen");
    expect(outlets.items).toEqual([{ id: "outlet", quantity: 2 }]);
    expect(outlets.items.some((item) => item.id === "electrician-labor")).toBe(false);

    const vague = keywordMatch("Fix some stuff");
    expect(vague.items).toEqual([]);
    expect(vague.vague).toBe(true);
    expect(vague.confidence).toBe("low");

    const parsed = interpretUnlistedModel(
      {
        items: [
          { id: "shelving", quantity: 1, unitPrice: 10 },
          { id: "not-a-real-job", quantity: 4 },
        ],
        estimatedHours: 8,
        materials: 0,
        confidence: "high",
        vague: false,
        total: 15,
        reasoning: "One shelf job.",
      },
      LIBRARY_SEED,
      "Build one shelf",
    );
    expect(parsed.selection.items).toEqual([{ id: "shelving", quantity: 1 }]);
    expect(parsed.selection.confidence).toBe("high");
    const priced = price({ ...parsed.selection, reasoning: parsed.reasoning });
    expect(priced.total).toBe(1000);

    const empty = interpretUnlistedModel(
      { items: [], estimatedHours: 4, materials: 20, confidence: "high", vague: false, reasoning: "Nothing fit." },
      LIBRARY_SEED,
      "Install 40 feet of baseboard in the hallway",
    );
    expect(empty.selection.items).toEqual([]);
    expect(empty.selection.estimatedHours).toBe(4);
  });

  it("changes travel later without repricing the library lines", () => {
    const quote = price({
      items: [{ id: "shelving", quantity: 1 }],
      estimatedHours: 8,
      miles: 10,
    });
    const shifted = pricedWithTravel(quote.lines, quote.quoteMeta, 80, "the previous job", settings, false);
    expect(shifted.lines.find((line) => line.label === "Shelving")?.amount).toBe(480);
    expect(shifted.lines.find((line) => line.label === "Time on the job")?.amount).toBe(470);
    expect(shifted.travelFee).toBe(80);
    expect(shifted.total).toBe(quote.total + 30);
    expect(shifted.meta.rangeHigh).toBe(quote.quoteMeta.rangeHigh + 30);
  });

  it("keeps an owner price edit and still shows a new seed row", () => {
    const merged = mergeLibrary([
      { id: "shelving", nationalHigh: 900, performs: false, keywords: ["should-not-stick"] },
    ]);
    const shelving = merged.find((entry) => entry.id === "shelving");
    expect(shelving?.nationalHigh).toBe(900);
    expect(shelving?.performs).toBe(false);
    expect(shelving?.keywords).toContain("shelf");
    expect(shelving?.keywords).not.toContain("should-not-stick");
    expect(merged).toHaveLength(37);
    expect(merged.find((entry) => entry.id === "baseboard")?.nationalHigh).toBe(9);
  });
});

describe("settings object is the shared default", () => {
  it("does not clone a different hourly rate into the library tests", () => {
    const snapshot: Settings = settings;
    expect(snapshot.builderThreshold).toBe(600);
    expect(snapshot.helperRate).toBe(100);
  });
});
