import { describe, expect, it } from "vitest";
import { cleanWallsText, paintCeilingArea, paintSizeLabel, paintWallArea, paintWallFeet, parseWallFeet, wallFeetTotal } from "@/lib/domain/paint";
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

  it("prices wall area from room length and width, times the number of rooms", () => {
    expect(paintWallFeet({ rooms: 1, roomLength: 14, roomWidth: 12 })).toBe(52);
    expect(paintWallArea({ rooms: 1, roomLength: 14, roomWidth: 12, height: "8" })).toBe(416);
    expect(paintWallArea({ rooms: 1, roomLength: 14, roomWidth: 12, height: "11" })).toBe(572);
    expect(paintWallFeet({ rooms: 3, roomLength: 10, roomWidth: 10 })).toBe(120);
    expect(paintSizeLabel({ rooms: 1, roomLength: 14, roomWidth: 12 })).toBe("14 × 12 ft room");
    expect(paintSizeLabel({ rooms: 3, roomLength: 10.5, roomWidth: 10 })).toBe("3 rooms about 10.5 × 10 ft each");
  });

  it("still prices quotes saved with wall lengths or only a floor area", () => {
    expect(paintWallArea({ walls: "12, 14, 12, 14", height: "8" })).toBe(416);
    expect(paintWallArea({ roomLength: 0, roomWidth: 0, walls: "12, 14, 12, 14", height: "8" })).toBe(416);
    // 144 sq ft of floor → 12 ft square → 48 ft of wall; 5 rooms of 1400 sq ft → 5 squares of 280
    expect(paintWallFeet({ walls: "", sqft: 144 })).toBe(48);
    expect(paintWallFeet({ rooms: 5, sqft: 1400 })).toBe(334.7);
    expect(paintWallArea({ walls: "", sqft: 144, height: "8" })).toBe(384);
    expect(paintWallFeet({ walls: "", sqft: 0 })).toBe(0);
  });

  it("gets ceiling area from the room size, or guesses it from walls or floor area", () => {
    expect(paintCeilingArea({ rooms: 1, roomLength: 14, roomWidth: 12 })).toBe(168);
    expect(paintCeilingArea({ rooms: 2, roomLength: 14, roomWidth: 12 })).toBe(336);
    expect(paintCeilingArea({ walls: "12, 14, 12, 14", rooms: 1 })).toBe(169);
    expect(paintCeilingArea({ walls: "12, 12, 12, 12, 12, 12, 12, 12", rooms: 2 })).toBe(288);
    expect(paintCeilingArea({ sqft: 150, rooms: 1 })).toBe(150);
    expect(paintCeilingArea({ rooms: 1 })).toBe(0);
  });

  it("keeps a 12 by 12 room with 8 ft ceilings close to the old floor-area price", () => {
    const quote = quoteCalc("paint", { ...DEFAULT_PARAMS, rooms: 1, roomLength: 12, roomWidth: 12, height: "8", cond: "good", doors: 0, colors: 1 }, DEFAULT_SETTINGS, "Wexford", 0);
    expect(quote.lines.find((l) => l.label === "Walls")?.amount).toBe(960);
    expect(quote.scope).toContain("12 × 12 ft room, about 384 sq ft of wall");
    const old = quoteCalc("paint", { ...DEFAULT_PARAMS, rooms: 1, roomLength: 0, roomWidth: 0, walls: "", sqft: 144, height: "8", cond: "good", doors: 0, colors: 1 }, DEFAULT_SETTINGS, "Wexford", 0);
    expect(old.lines.find((l) => l.label === "Walls")?.amount).toBe(960);
  });
});
