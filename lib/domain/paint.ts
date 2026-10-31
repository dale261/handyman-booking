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

/** The size answers a paint quote can carry. Older quotes are missing the newer keys. */
export type PaintSize = Partial<Pick<QuoteParams, "rooms" | "roomLength" | "roomWidth" | "walls" | "sqft">>;

function roomsOf(p: PaintSize): number {
  return Math.max(1, Math.round(num(p.rooms, 1)));
}

function dims(p: PaintSize): { length: number; width: number } | null {
  const length = num(p.roomLength, 0);
  const width = num(p.roomWidth, 0);
  return length > 0 && width > 0 ? { length, width } : null;
}

/**
 * Total feet of wall to paint. Room length and width win: each room is
 * 2 × (length + width). Quotes from the day the form asked for wall lengths use
 * those, and older quotes that only saved a floor area are treated as square rooms,
 * so nobody's price jumps.
 */
export function paintWallFeet(p: PaintSize): number {
  const rooms = roomsOf(p);
  const size = dims(p);
  if (size) return Math.round(2 * (size.length + size.width) * rooms * 10) / 10;
  const typed = wallFeetTotal(p.walls ?? "");
  if (typed > 0) return typed;
  const sq = Math.max(0, num(p.sqft, 0));
  return sq > 0 ? Math.round(4 * Math.sqrt(sq / rooms) * rooms * 10) / 10 : 0;
}

/** Square feet of wall: every wall length times the ceiling height. */
export function paintWallArea(p: PaintSize & Pick<QuoteParams, "height">): number {
  return Math.round(paintWallFeet(p) * heightFeet(p.height));
}

/**
 * Ceiling area: length × width per room when we have the size. Wall-length quotes
 * treat each room as a square (long narrow rooms come out a little high, the side
 * we want to err on). Floor-area quotes use the area they saved.
 */
export function paintCeilingArea(p: PaintSize): number {
  const rooms = roomsOf(p);
  const size = dims(p);
  if (size) return Math.round(size.length * size.width * rooms);
  const typed = wallFeetTotal(p.walls ?? "");
  if (typed > 0) {
    const side = typed / rooms / 4;
    return Math.round(side * side * rooms);
  }
  const sq = Math.max(0, num(p.sqft, 0));
  return Math.round(sq);
}

/** "12 × 14 ft" or "5 rooms about 12 × 14 ft each", for the quote lines. */
export function paintSizeLabel(p: PaintSize): string {
  const rooms = roomsOf(p);
  const size = dims(p);
  if (!size) return `${paintWallFeet(p)} ft of wall`;
  const l = Number.isInteger(size.length) ? size.length : size.length.toFixed(1);
  const w = Number.isInteger(size.width) ? size.width : size.width.toFixed(1);
  return rooms === 1 ? `${l} × ${w} ft room` : `${rooms} rooms about ${l} × ${w} ft each`;
}
