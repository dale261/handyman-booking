import type { JobRecord, PayItem, PayLine, ShopHoursEntry } from "@/lib/db/types";
import { addDays, isDate, SHOP_LABEL } from "@/lib/domain/hours";
import { roundCents } from "@/lib/domain/money";

/**
 * Crew pay. Each line of pay carries its own rate, because the rate changes with the
 * job and the day. What someone is owed is what they earned less what they've been paid.
 */
export const PAY_LIMITS = { rateMax: 500, amountMax: 50000, daysBack: 730, textMin: 2, textMax: 200 };

type Bad = { ok: false; error: string };

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, PAY_LIMITS.textMax);
}

/** Dollars an hour. Zero is allowed: hours that are tracked but not paid. */
export function checkRate(value: number): { ok: true; rate: number } | Bad {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate < 0) return { ok: false, error: "Enter the rate in dollars an hour, such as 20." };
  if (rate > PAY_LIMITS.rateMax) return { ok: false, error: `That's over $${PAY_LIMITS.rateMax} an hour. Check the number.` };
  return { ok: true, rate: roundCents(rate) };
}

/** Hourly pay is always hours times rate, to the cent. */
export function payFor(hours: number, rate: number): number {
  return roundCents(hours * rate);
}

/** A real day, not in the future. Old days are fine: past pay gets entered after the fact. */
export function checkPayDay(value: string, today: string): { ok: true; date: string } | Bad {
  const date = value.trim();
  if (!isDate(date)) return { ok: false, error: "Pick the day." };
  if (date > today) return { ok: false, error: "That day hasn't happened yet." };
  if (date < addDays(today, -PAY_LIMITS.daysBack)) return { ok: false, error: "That day is more than two years back. Check the year." };
  return { ok: true, date };
}

export function checkAmount(value: number): { ok: true; amount: number } | Bad {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0.01) return { ok: false, error: "Enter the amount in dollars, such as 150." };
  if (amount > PAY_LIMITS.amountMax) return { ok: false, error: `That's over $${PAY_LIMITS.amountMax.toLocaleString("en-US")}. Check the amount.` };
  return { ok: true, amount: roundCents(amount) };
}

export function checkFlatPay(input: { date: string; amount: number; what: string }, today: string): { ok: true; date: string; amount: number; what: string } | Bad {
  const day = checkPayDay(input.date, today);
  if (!day.ok) return day;
  const amount = checkAmount(input.amount);
  if (!amount.ok) return amount;
  const what = clean(input.what);
  if (what.length < PAY_LIMITS.textMin) return { ok: false, error: "Say what it was for, such as 'Flat rate for the siding job'." };
  return { ok: true, date: day.date, amount: amount.amount, what };
}

export function checkPayment(input: { date: string; amount: number; note: string }, today: string): { ok: true; date: string; amount: number; note: string } | Bad {
  const day = checkPayDay(input.date, today);
  if (!day.ok) return day;
  const amount = checkAmount(input.amount);
  if (!amount.ok) return amount;
  return { ok: true, date: day.date, amount: amount.amount, note: clean(input.note) };
}

/** One hours entry from anywhere in the app: on a job, or shop time. */
export type LoggedHours = {
  entryId: string;
  workerId: string;
  workerName: string;
  date: string;
  hours: number;
  note: string;
  /** Null for shop time. */
  jobId: string | null;
  /** The job's title, or "Shop time". */
  what: string;
  at: string;
};

/** Every hours entry in the app, job hours and shop time together, newest day first. */
export function loggedHours(jobs: Pick<JobRecord, "id" | "scope" | "hours">[], shop: ShopHoursEntry[]): LoggedHours[] {
  const all: LoggedHours[] = [];
  for (const job of jobs) {
    for (const entry of job.hours ?? []) {
      all.push({ entryId: entry.id, workerId: entry.workerId, workerName: entry.workerName, date: entry.date, hours: entry.hours, note: entry.note, jobId: job.id, what: job.scope || "Job", at: entry.at });
    }
  }
  for (const entry of shop) {
    all.push({ entryId: entry.id, workerId: entry.workerId, workerName: entry.workerName, date: entry.date, hours: entry.hours, note: entry.note, jobId: null, what: SHOP_LABEL, at: entry.at });
  }
  return all.sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
}

function isLine(item: PayItem): item is PayLine {
  return item.kind === "pay";
}

/** The pay line set on an hours entry, if there is one. */
export function lineFor(pay: PayItem[], entryId: string): PayLine | undefined {
  return pay.filter(isLine).find((line) => line.entryId === entryId);
}

/**
 * Hours with no pay set on them yet. `skip` is the people whose hours are tracked but
 * never paid through here: the owner.
 */
export function needsRate(logged: LoggedHours[], pay: PayItem[], skip: string[] = []): LoggedHours[] {
  const priced = new Set(pay.filter(isLine).map((line) => line.entryId).filter((id): id is string => Boolean(id)));
  return logged.filter((entry) => !priced.has(entry.entryId) && !skip.includes(entry.workerId));
}

export type RateHint = { rate: number; from: "this job" | "shop time" | "other work" };

/**
 * A rate to offer when pricing hours: what this person last got on the same job, or on
 * shop time when it is shop time, and failing that what they last got anywhere. It is
 * only an offer. The owner sets every rate, because rates change with the job.
 */
export function suggestRate(pay: PayItem[], workerId: string, jobId: string | null): RateHint | null {
  const lines = pay
    .filter(isLine)
    .filter((line) => line.workerId === workerId && line.rate !== null)
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  const same = jobId ? lines.find((line) => line.jobId === jobId) : lines.find((line) => !line.jobId && line.what === SHOP_LABEL);
  if (same) return { rate: same.rate as number, from: jobId ? "this job" : "shop time" };
  const any = lines[0];
  return any ? { rate: any.rate as number, from: "other work" } : null;
}

export type Balance = {
  workerId: string;
  workerName: string;
  earned: number;
  paid: number;
  /** Earned less paid. Negative when they have been paid ahead. */
  owed: number;
  /** The day of the latest payment, if there has been one. */
  lastPaid: string | null;
};

/** Everyone with pay or payments on record: what they earned, were paid and are owed. Most owed first. */
export function balances(pay: PayItem[]): Balance[] {
  const people = new Map<string, Balance>();
  // Newest first, so the name kept for each person is the one on their latest record.
  const sorted = [...pay].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  for (const item of sorted) {
    const person = people.get(item.workerId) ?? { workerId: item.workerId, workerName: item.workerName, earned: 0, paid: 0, owed: 0, lastPaid: null };
    if (item.kind === "pay") person.earned = roundCents(person.earned + item.amount);
    else {
      person.paid = roundCents(person.paid + item.amount);
      if (!person.lastPaid) person.lastPaid = item.date;
    }
    person.owed = roundCents(person.earned - person.paid);
    people.set(item.workerId, person);
  }
  return [...people.values()].sort((a, b) => b.owed - a.owed || a.workerName.localeCompare(b.workerName));
}

/** What is owed across everyone who is owed something. People paid ahead don't offset the others. */
export function totalOwed(list: Balance[]): number {
  return roundCents(list.filter((person) => person.owed > 0).reduce((sum, person) => sum + person.owed, 0));
}
