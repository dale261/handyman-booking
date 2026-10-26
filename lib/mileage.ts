import type { Repository } from "@/lib/db/repository";
import type { Settings } from "@/lib/domain/types";
import { fallbackRoadMiles, haversineMiles, roadMilesBetween, type RoadMiles } from "@/lib/domain/travel";

export type Point = {
  address: string;
  lat: number | null;
  lng: number | null;
  zipMiles: number | null;
};

function cacheKey(a: { lat: number; lng: number }, b: { lat: number; lng: number }): string {
  const r = (n: number) => n.toFixed(3);
  return `${r(a.lat)},${r(a.lng)}|${r(b.lat)},${r(b.lng)}`;
}

export async function geocodeAddress(repo: Repository, address: string): Promise<{ lat: number; lng: number } | null> {
  const key = address.trim().toLowerCase();
  if (!key) return null;
  const cached = await repo.getGeo(key);
  if (cached) return cached;
  if (process.env.VITEST) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(address)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "eXConstructionLC/1.0 (handyman booking; Cadillac MI)", Accept: "application/json" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { lat?: string; lon?: string }[];
    const lat = Number(body[0]?.lat);
    const lng = Number(body[0]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const point = { lat, lng };
    await repo.saveGeo(key, point);
    return point;
  } catch {
    return null;
  }
}

export async function measureLeg(repo: Repository, settings: Settings, from: Point | "shop", to: Point): Promise<RoadMiles & { fromLabel: string }> {
  const origin: Point =
    from === "shop"
      ? { address: settings.shopAddress, lat: settings.shopLat, lng: settings.shopLng, zipMiles: 0 }
      : from;
  const fromLabel = from === "shop" ? `the shop (${settings.shopAddress})` : from.address;

  if (origin.lat != null && origin.lng != null && to.lat != null && to.lng != null) {
    const key = cacheKey({ lat: origin.lat, lng: origin.lng }, { lat: to.lat, lng: to.lng });
    const cached = await repo.getRoute(key);
    if (cached != null) {
      const source = cached.source === "openrouteservice" || cached.source === "osrm" || cached.source === "straight-line" || cached.source === "zip-table"
        ? cached.source
        : "straight-line";
      return { miles: cached.miles, source, fromLabel };
    }
    const measured = await roadMilesBetween(
      { lat: origin.lat, lng: origin.lng },
      { lat: to.lat, lng: to.lng },
      {
        roadFactor: settings.roadFactor,
        orsKey: process.env.ORS_API_KEY,
        osrmBase: process.env.VITEST ? undefined : process.env.OSRM_BASE_URL,
      },
    );
    await repo.saveRoute(key, measured.miles, measured.source);
    return { ...measured, fromLabel };
  }

  if (from === "shop" && to.zipMiles != null) {
    return { miles: fallbackRoadMiles(to.zipMiles, settings.roadFactor), source: "zip-table", fromLabel };
  }

  if (from !== "shop" && from.zipMiles != null && to.zipMiles != null) {
    const straight = Math.abs(from.zipMiles - to.zipMiles);
    return {
      miles: fallbackRoadMiles(straight, settings.roadFactor),
      source: "zip-table",
      fromLabel,
    };
  }

  if (origin.lat != null && origin.lng != null && to.lat != null && to.lng != null) {
    return {
      miles: fallbackRoadMiles(haversineMiles({ lat: origin.lat, lng: origin.lng }, { lat: to.lat, lng: to.lng }), settings.roadFactor),
      source: "straight-line",
      fromLabel,
    };
  }

  return { miles: 0, source: "straight-line", fromLabel };
}
