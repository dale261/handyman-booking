type HeaderSource = { get(name: string): string | null };

/** First hop of x-forwarded-for, then x-real-ip. Capped so a huge header cannot bloat the limit table. */
export function clientIp(headerSource: HeaderSource): string {
  const forwarded = headerSource.get("x-forwarded-for");
  const first = forwarded ? forwarded.split(",")[0]?.trim() : "";
  const raw = first || headerSource.get("x-real-ip")?.trim() || "unknown";
  return raw.slice(0, 80);
}
