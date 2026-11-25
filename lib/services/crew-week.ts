import type { Repository } from "@/lib/db/repository";
import type { Actor, CrewEntry, PayItem, PayLine, ShopHoursEntry } from "@/lib/db/types";
import { addDays, entriesFor, roundHours, weekStart } from "@/lib/domain/hours";
import { roundCents } from "@/lib/domain/money";
import { leadCrew } from "@/lib/services/lead";

/** One entry of logged hours as a crew lead sees it: the hours, and what they pay if a rate is on them. */
export type CrewWeekEntry = {
  id: string;
  /** Blank for shop time. */
  jobId: string;
  date: string;
  hours: number;
  what: string;
  note: string;
  /** Dollars an hour, or null when no rate is on these hours yet. */
  rate: number | null;
  /** What the hours pay, or null when no rate is on them yet. */
  pay: number | null;
};

/** Pay dated in the week that isn't one of the logged entries: a flat amount, or a line from the owner's own records. */
export type CrewWeekOther = { id: string; date: string; what: string; hours: number | null; rate: number | null; amount: number };

export type CrewWeekMember = {
  id: string;
  fullName: string;
  me: boolean;
  /** Hours logged in the week. */
  hours: number;
  /** What the week pays so far: the entries that have a rate, plus any other pay dated in it. */
  earned: number;
  /** Hours in the week with no rate on them yet. */
  waiting: number;
  entries: CrewWeekEntry[];
  other: CrewWeekOther[];
};

export type CrewWeek = { crewName: string; start: string; end: string; members: CrewWeekMember[] };

/**
 * A week of hours and pay for the crew this person leads, or null when they don't lead
 * one. It holds what the owner said a lead may see and nothing else:
 *
 * - only people on the lead's own crew;
 * - their hours, the rate on each entry, and what it pays;
 * - never a payment the owner made, never what anyone is still owed, and never the rate
 *   list itself.
 *
 * Everything on the lead's screen comes from here, so this is the one place that decides it.
 */
export async function crewWeek(repo: Repository, actor: Actor, day: string): Promise<CrewWeek | null> {
  const crew = await leadCrew(repo, actor);
  if (!crew) return null;
  const start = weekStart(day);
  const end = addDays(start, 6);
  const ids = new Set(crew.members.map((member) => member.id));
  const jobs = await repo.listJobs();
  const log: CrewEntry[] = await repo.listCrewEntries().catch(() => []);
  const shop = log.filter((entry): entry is ShopHoursEntry => entry.kind === "shop_hours" && ids.has(entry.workerId));
  // Pay lines only, and only this crew's. Payments are dropped here, before anything is built.
  const pay: PayItem[] = await repo.listPay().catch(() => []);
  const lines = pay.filter((item): item is PayLine => item.kind === "pay" && ids.has(item.workerId));

  const members = crew.members.map((member): CrewWeekMember => {
    const logged = entriesFor(jobs, member.id, start, end, shop);
    const shown = new Set(logged.map((entry) => entry.id));
    const entries = logged.map((entry): CrewWeekEntry => {
      const line = lines.find((item) => item.entryId === entry.id);
      return { id: entry.id, jobId: entry.jobId, date: entry.date, hours: entry.hours, what: entry.scope, note: entry.note, rate: line ? line.rate : null, pay: line ? line.amount : null };
    });
    const other = lines
      .filter((line) => line.workerId === member.id && line.date >= start && line.date <= end && !(line.entryId && shown.has(line.entryId)))
      .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at))
      .map((line): CrewWeekOther => ({ id: line.id, date: line.date, what: line.what, hours: line.hours, rate: line.rate, amount: line.amount }));
    return {
      id: member.id,
      fullName: member.fullName,
      me: member.id === crew.me.id,
      hours: roundHours(entries.reduce((sum, entry) => sum + entry.hours, 0)),
      earned: roundCents(entries.reduce((sum, entry) => sum + (entry.pay ?? 0), 0) + other.reduce((sum, line) => sum + line.amount, 0)),
      waiting: roundHours(entries.filter((entry) => entry.pay === null).reduce((sum, entry) => sum + entry.hours, 0)),
      entries,
      other,
    };
  });
  return { crewName: crew.crewName, start, end, members };
}
