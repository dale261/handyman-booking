const TZ = "America/Detroit";

export function usd(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatMinutes(min: number): string {
  const normalized = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  const h12 = ((h + 11) % 12) + 1;
  const ap = h < 12 ? "a.m." : "p.m.";
  return `${h12}:${String(m).padStart(2, "0")} ${ap}`;
}

export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function nowMinutesDetroit(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  let hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  if (hour === 24) hour = 0;
  return hour * 60 + minute;
}

export function todayDetroit(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** Sunday = 0 ... Saturday = 6, for a calendar date. */
export function weekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:43123").replace(/\/$/, "");
}

export function jobUrl(id: string): string {
  return `${appUrl()}/jobs/${id}`;
}
