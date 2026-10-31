import { describe, expect, it } from "vitest";
import { cleanWallsText, paintCeilingArea, paintWallArea, paintWallFeet, parseWallFeet, wallFeetTotal } from "@/lib/domain/paint";
import { DEFAULT_SETTINGS } from "@/lib/domain/settings";
import { quoteCalc } from "@/lib/domain/pricing";
import { DEFAULT_PARAMS } from "@/lib/domain/types";

describe("wall lengths", () => {
  it("reads a comma list, a room size, and ignores junk", () => {
    expect(parseWallFeet("12, 14, 12, 14")).toEqual([12, 14, 12, 14]);
    expect(parseWallFeet("12 14 12 14")).toEqual([12, 14, 12, 14]);
    expect(parseWallFeet("12x14")).toEqual([12, 14, 12, 14]);
    expect(parseWallFeet("12 x 14")).toEqual([12, 14, 12, 14]);
    expect(parseWallFeet("10.5, abc, 0, 900, 8")).toEqual([10.5, 8]);
    expect(parseWallFeet("")).toEqual([]);
    expect(wallFeetTotal("12, 14, 12, 14")).toBe(52);
    expect(cleanWallsText("12ft, 14 ft; <b>12</b>").length).toBeLessThanOrEqual(200);
  });

  it("prices wall area, and falls back to a square room for quotes that only saved floor area", () => {
    expect(paintWallArea({ walls: "12, 14, 12, 14", sqft: 0, height: "8" })).toBe(416);
    expect(paintWallArea({ walls: "12, 14, 12, 14", sqft: 0, height: "11" })).toBe(572);
    // 144 sq ft of floor → 12 ft square → 48 ft of wall
    expect(paintWallFeet({ walls: "", sqft: 144 })).toBe(48);
    expect(paintWallArea({ walls: "", sqft: 144, height: "8" })).toBe(384);
    expect(paintWallFeet({ walls: "", sqft: 0 })).toBe(0);
  });

  it("guesses ceiling area per room from the walls", () => {
    expect(paintCeilingArea({ walls: "12, 14, 12, 14", sqft: 0, rooms: 1 })).toBe(169);
    expect(paintCeilingArea({ walls: "12, 12, 12, 12, 12, 12, 12, 12", sqft: 0, rooms: 2 })).toBe(288);
    expect(paintCeilingArea({ walls: "", sqft: 0, rooms: 1 })).toBe(0);
  });

  it("keeps a 12 by 12 room with 8 ft ceilings close to the old floor-area price", () => {
    const quote = quoteCalc("paint", { ...DEFAULT_PARAMS, rooms: 1, walls: "12, 12, 12, 12", height: "8", cond: "good", doors: 0, colors: 1 }, DEFAULT_SETTINGS, "Wexford", 0);
    expect(quote.lines.find((l) => l.label === "Walls")?.amount).toBe(960);
    expect(quote.scope).toContain("384 sq ft of wall");
    const old = quoteCalc("paint", { ...DEFAULT_PARAMS, rooms: 1, walls: "", sqft: 144, height: "8", cond: "good", doors: 0, colors: 1 }, DEFAULT_SETTINGS, "Wexford", 0);
    expect(old.lines.find((l) => l.label === "Walls")?.amount).toBe(960);
  });
});
