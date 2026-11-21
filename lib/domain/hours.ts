import type { HoursEntry, JobRecord, JobStatus, ShopHoursEntry } from "@/lib/db/types";

/**
 * Hours a crew member logs against a job. They live on the job record, so there is
 * no separate table to keep in step. A week runs Monday through Sunday.
 */
export const HOURS_LIMITS = { min: 0.25, max: 16, step: 0.25, daysBack: 31, noteMax: 200, perJob: 500 };

/** Jobs a crew member can log time against: booked work, work underway, and finished work. */
export const HOURS_STATUSES: JobStatus[] = ["booked", "price_change", "in_progress", "awaiting_approval", "disputed", "balance_due", "completed", "reviewed", "cancel_requested"];

function toUtc(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}

function fromUtc(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

export function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return fromUtc(toUtc(value)) === value;
}

export function addDays(date: string, days: number): string {
  const dt = toUtc(date);
  dt.setUTCDate(dt.getUTCDate() + days);
  return fromUtc(dt);
}

/** The Monday of the week a date falls in. */
export function weekStart(date: string): string {
  const day = toUtc(date).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(date, day === 0 ? -6 : 1 - day);
}

/** The seven dates of a week, Monday first. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Keeps sums like 7.25 + 0.5 from picking up stray decimals. */
export function roundHours(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "7.5 hrs", "1 hr". */
export function hoursLabel(value: number): string {
  const n = roundHours(value);
  return `${n} ${n === 1 ? "hr" : "hrs"}`;
}

export type HoursCheck = { ok: true; date: string; hours: number; note: string } | { ok: false; error: string };

/** A day worked and how long: a real date, not in the future, not too far back, in quarter hours. */
export function checkHours(input: { date: string; hours: number; note: string }, today: string): HoursCheck {
  const date = input.date.trim();
  if (!isDate(date)) return { ok: false, error: "Pick the day you worked." };
  if (date > today) return { ok: false, error: "That day hasn't happened yet." };
  if (date < addDays(today, -HOURS_LIMITS.daysBack)) return { ok: false, error: `Hours can be added up to ${HOURS_LIMITS.daysBack} days back. For anything older, ask the owner.` };
  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours < HOURS_LIMITS.min) return { ok: false, error: "Enter how many hours you worked, such as 3.5." };
  if (hours > HOURS_LIMITS.max) return { ok: false, error: `That's more than ${HOURS_LIMITS.max} hours in one entry. Check the number.` };
  // Quarter hours keep the totals tidy.
  if (Math.abs(hours * 4 - Math.round(hours * 4)) > 1e-9) return { ok: false, error: "Use quarter hours: 1, 1.25, 1.5, 1.75." };
  return { ok: true, date, hours: roundHours(hours), note: input.note.trim().slice(0, HOURS_LIMITS.noteMax) };
}

type JobHours = Pick<JobRecord, "id" | "scope" | "hours">;

/** How shop time is named wherever hours are listed. It has no job, so its job id is blank. */
export const SHOP_LABEL = "Shop time";

export type WorkerWeek = {
  workerId: string;
  workerName: string;
  total: number;
  /** Hours on each date of the week; a day with nothing logged is missing. */
  byDay: Record<string, number>;
  byJob: { jobId: string; scope: string; hours: number }[];
};

/** Everyone's hours for the week starting on `start`, busiest first. Shop time counts with job time. */
export function weekTotals(jobs: JobHours[], start: string, shop: ShopHoursEntry[] = []): WorkerWeek[] {
  const end = addDays(start, 6);
  const people = new Map<string, WorkerWeek>();
  for (const job of jobs) {
    for (const entry of job.hours ?? []) {
      if (entry.date < start || entry.date > end) continue;
      let person = people.get(entry.workerId);
      if (!person) {
        person = { workerId: entry.workerId, workerName: entry.workerName, total: 0, byDay: {}, byJob: [] };
        people.set(entry.workerId, person);
      }
      person.total = roundHours(person.total + entry.hours);
      person.byDay[entry.date] = roundHours((person.byDay[entry.date] ?? 0) + entry.hours);
      const onJob = person.byJob.find((item) => item.jobId === job.id);
      if (onJob) onJob.hours = roundHours(onJob.hours + entry.hours);
      else person.byJob.push({ jobId: job.id, scope: job.scope || "Job", hours: roundHours(entry.hours) });
    }
  }
  for (const entry of shop) {
    if (entry.date < start || entry.date > end) continue;
    let person = people.get(entry.workerId);
    if (!person) {
      person = { workerId: entry.workerId, workerName: entry.workerName, total: 0, byDay: {}, byJob: [] };
      people.set(entry.workerId, person);
    }
    person.total = roundHours(person.total + entry.hours);
    person.byDay[entry.date] = roundHours((person.byDay[entry.date] ?? 0) + entry.hours);
    const line = person.byJob.find((item) => item.jobId === "");
    if (line) line.hours = roundHours(line.hours + entry.hours);
    else person.byJob.push({ jobId: "", scope: SHOP_LABEL, hours: roundHours(entry.hours) });
  }
  return [...people.values()].sort((a, b) => b.total - a.total || a.workerName.localeCompare(b.workerName));
}

export type HoursLine = HoursEntry & { jobId: string; scope: string };

/** One person's entries in a date range, newest day first, each tagged with its job. Shop time has a blank job id. */
export function entriesFor(jobs: JobHours[], workerId: string, from: string, to: string, shop: ShopHoursEntry[] = []): HoursLine[] {
  const lines: HoursLine[] = [];
  for (const job of jobs) {
    for (const entry of job.hours ?? []) {
      if (entry.workerId !== workerId || entry.date < from || entry.date > to) continue;
      lines.push({ ...entry, jobId: job.id, scope: job.scope || "Job" });
    }
  }
  for (const entry of shop) {
    if (entry.workerId !== workerId || entry.date < from || entry.date > to) continue;
    lines.push({ id: entry.id, workerId: entry.workerId, workerName: entry.workerName, date: entry.date, hours: entry.hours, note: entry.note, at: entry.at, jobId: "", scope: SHOP_LABEL });
  }
  return lines.sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
}

export function totalHours(entries: Pick<HoursEntry, "hours">[]): number {
  return roundHours(entries.reduce((sum, entry) => sum + entry.hours, 0));
}
