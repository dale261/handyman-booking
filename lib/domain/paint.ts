import { num } from "./money";
import type { QuoteParams } from "./types";

/** Longest single wall we accept, in feet. Anything bigger is a typo. */
const MAX_WALL_FT = 200;
export const MAX_WALLS_TEXT = 200;

/** Keep only what a list of wall lengths can contain: digits, decimal points, commas, spaces, and x. */
export function cleanWallsText(input: unknown): string {
  return String(input ?? "")
    .replace(/[^\d.,x×\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_WALLS_TEXT);
}

/**
 * "12, 14, 12, 14" → [12, 14, 12, 14]. Also reads "12 x 14" as two walls of 12 and
 * two of 14, since people describe a room that way. Zero and junk are dropped.
 */
export function parseWallFeet(text: string): number[] {
  // "12 x 14" and "12x14" both mean a room of two 12 ft walls and two 14 ft walls.
  const cleaned = cleanWallsText(text).replace(/\s*([x×])\s*/gi, "$1");
  if (!cleaned) return [];
  const feet: number[] = [];
  for (const part of cleaned.split(/[,\s]+/)) {
    const pair = part.match(/^(\d+(?:\.\d+)?)[x×](\d+(?:\.\d+)?)$/i);
    if (pair) {
      const a = Number(pair[1]);
      const b = Number(pair[2]);
      if (a > 0 && b > 0) feet.push(a, b, a, b);
      continue;
    }
    const value = Number(part);
    if (Number.isFinite(value) && value > 0 && value <= MAX_WALL_FT) feet.push(value);
  }
  return feet;
}

export function wallFeetTotal(text: string): number {
  return Math.round(parseWallFeet(text).reduce((sum, value) => sum + value, 0) * 10) / 10;
}

/** The ceiling height the quote prices at. The "11 ft or vaulted" choice is priced as 11 ft. */
export function heightFeet(height: QuoteParams["height"]): number {
  return height === "11" ? 11 : height === "9" ? 9 : 8;
}

/**
 * Total feet of wall to paint. Wall lengths win. Older quotes that only saved a
 * floor area are treated as a square room so their price stays about the same.
 */
export function paintWallFeet(p: Pick<QuoteParams, "walls" | "sqft">): number {
  const typed = wallFeetTotal(p.walls ?? "");
  if (typed > 0) return typed;
  const sq = Math.max(0, num(p.sqft, 0));
  return sq > 0 ? Math.round(4 * Math.sqrt(sq) * 10) / 10 : 0;
}

/** Square feet of wall: every wall length times the ceiling height. */
export function paintWallArea(p: Pick<QuoteParams, "walls" | "sqft" | "height">): number {
  return Math.round(paintWallFeet(p) * heightFeet(p.height));
}

/**
 * Ceiling area guessed from the walls: each room is treated as a square with a
 * quarter of its share of the wall length per side. Long narrow rooms come out a
 * little high, which is the side we want to err on.
 */
export function paintCeilingArea(p: Pick<QuoteParams, "walls" | "sqft" | "rooms">): number {
  const rooms = Math.max(1, Math.round(num(p.rooms, 1)));
  const feet = paintWallFeet(p);
  if (feet <= 0) return 0;
  const side = feet / rooms / 4;
  return Math.round(side * side * rooms);
}
