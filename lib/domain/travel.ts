import { roundCents } from "./money";

export type LatLng = { lat: number; lng: number };

const EARTH_MILES = 3958.7613;

export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Straight-line miles × the owner's road factor (default 1.25). */
export function fallbackRoadMiles(straightMiles: number, roadFactor: number): number {
  const straight = Math.max(0, straightMiles);
  const factor = roadFactor > 0 ? roadFactor : 1.25;
  return roundCents(straight * factor);
}

export function driveMinutes(roadMiles: number, driveFactor: number, padMinutes: number): number {
  return Math.max(0, Math.round(Math.max(0, roadMiles) * driveFactor) + padMinutes);
}

export type RouteSource = "openrouteservice" | "osrm" | "straight-line" | "zip-table";

export type RoadMiles = { miles: number; source: RouteSource };

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Road miles between two points.
 * Tries OpenRouteService when a key is set, then OSRM when a base URL is set,
 * then straight-line × roadFactor.
 */
export async function roadMilesBetween(
  from: LatLng,
  to: LatLng,
  opts: {
    roadFactor: number;
    orsKey?: string;
    osrmBase?: string;
    fetchImpl?: FetchLike;
    timeoutMs?: number;
  },
): Promise<RoadMiles> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 4000;
  const straight = fallbackRoadMiles(haversineMiles(from, to), opts.roadFactor);

  if (opts.orsKey) {
    try {
      const miles = await orsMiles(from, to, opts.orsKey, fetchImpl, timeoutMs);
      if (miles != null) return { miles: roundCents(miles), source: "openrouteservice" };
    } catch {
      /* try the next option */
    }
  }

  if (opts.osrmBase) {
    try {
      const miles = await osrmMiles(from, to, opts.osrmBase, fetchImpl, timeoutMs);
      if (miles != null) return { miles: roundCents(miles), source: "osrm" };
    } catch {
      /* fall through */
    }
  }

  return { miles: straight, source: "straight-line" };
}

async function orsMiles(from: LatLng, to: LatLng, key: string, fetchImpl: FetchLike, timeoutMs: number): Promise<number | null> {
  const res = await fetchImpl("https://api.openrouteservice.org/v2/directions/driving-car", {
    method: "POST",
    headers: { Authorization: key, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: [[from.lng, from.lat], [to.lng, to.lat]] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { routes?: { summary?: { distance?: number } }[] };
  const meters = body.routes?.[0]?.summary?.distance;
  if (typeof meters !== "number" || !Number.isFinite(meters)) return null;
  return meters / 1609.344;
}

async function osrmMiles(from: LatLng, to: LatLng, base: string, fetchImpl: FetchLike, timeoutMs: number): Promise<number | null> {
  const root = base.replace(/\/$/, "");
  const url = `${root}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) return null;
  const body = (await res.json()) as { routes?: { distance?: number }[] };
  const meters = body.routes?.[0]?.distance;
  if (typeof meters !== "number" || !Number.isFinite(meters)) return null;
  return meters / 1609.344;
}

export function billedMiles(travelLocked: boolean, lockedMiles: number | null, liveMiles: number): number {
  if (travelLocked && lockedMiles != null && Number.isFinite(lockedMiles)) return lockedMiles;
  return liveMiles;
}
