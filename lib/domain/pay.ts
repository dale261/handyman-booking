import type { CrewRate, JobRecord, PayItem, PayLine, PayMethod, ShopHoursEntry } from "@/lib/db/types";
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

export const PAY_METHODS: { id: PayMethod; label: string }[] = [
  { id: "cash", label: "Cash" },
  { id: "paypal", label: "PayPal" },
  { id: "check", label: "Check" },
  { id: "other", label: "Other" },
];

/** How a payment was made, from whatever a form or a file says. Anything unknown is left out. */
export function readMethod(value: string | undefined): PayMethod | undefined {
  const want = (value ?? "").trim().toLowerCase();
  if (want === "cheque") return "check";
  return PAY_METHODS.find((method) => method.id === want)?.id;
}

export function methodLabel(method: PayMethod | undefined): string {
  return PAY_METHODS.find((item) => item.id === method)?.label ?? "";
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

/** The two scopes on the rate list that aren't a job. */
export const RATE_USUAL = "usual";
export const RATE_SHOP = "shop";

export function rateId(workerId: string, scope: string): string {
  return `${workerId}:${scope}`;
}

export type ListRate = { rate: number; from: "job" | "shop" | "usual" };

/**
 * What the owner's rate list says these hours pay. On a job: the rate set for that person
 * on that job, else their usual rate. Shop time: their shop rate and nothing else, because
 * shop time is often paid differently from job work. Null means the list doesn't say, and
 * the hours wait for the owner.
 */
export function rateFor(rates: CrewRate[], workerId: string, jobId: string | null): ListRate | null {
  const mine = rates.filter((rate) => rate.workerId === workerId);
  if (!jobId) {
    const shop = mine.find((rate) => rate.scope === RATE_SHOP);
    return shop ? { rate: shop.rate, from: "shop" } : null;
  }
  const job = mine.find((rate) => rate.scope === jobId);
  if (job) return { rate: job.rate, from: "job" };
  const usual = mine.find((rate) => rate.scope === RATE_USUAL);
  return usual ? { rate: usual.rate, from: "usual" } : null;
}

export type RateHint = { rate: number; from: "the rate list" | "this job" | "shop time" | "other work" };

/**
 * A rate to offer when the owner prices hours by hand: what the rate list says, else what
 * this person last got on the same job (or on shop time), else what they last got
 * anywhere. It is only an offer.
 */
export function suggestRate(pay: PayItem[], workerId: string, jobId: string | null, rates: CrewRate[] = []): RateHint | null {
  const listed = rateFor(rates, workerId, jobId);
  if (listed) return { rate: listed.rate, from: "the rate list" };
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
  /** Hours on their pay lines. Hours that are logged but have no rate yet aren't in it. */
  hours: number;
  /** The day of the latest payment, if there has been one. */
  lastPaid: string | null;
};

/** Everyone with pay or payments on record: what they earned, were paid and are owed. Most owed first. */
export function balances(pay: PayItem[]): Balance[] {
  const people = new Map<string, Balance>();
  // Newest first, so the name kept for each person is the one on their latest record.
  const sorted = [...pay].sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  for (const item of sorted) {
    const person = people.get(item.workerId) ?? { workerId: item.workerId, workerName: item.workerName, earned: 0, paid: 0, owed: 0, hours: 0, lastPaid: null };
    if (item.kind === "pay") {
      person.earned = roundCents(person.earned + item.amount);
      person.hours = roundCents(person.hours + (item.hours ?? 0));
    } else {
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

/**
 * Rates this person has been paid on a job that the rate list doesn't have yet: the
 * latest rate for each job, newest first. Offered to the owner as one-tap additions.
 */
export function seenJobRates(pay: PayItem[], rates: CrewRate[], workerId: string): { jobId: string; rate: number; date: string }[] {
  const have = new Set(rates.filter((rate) => rate.workerId === workerId).map((rate) => rate.scope));
  const latest = new Map<string, { jobId: string; rate: number; date: string }>();
  const lines = pay
    .filter(isLine)
    .filter((line) => line.workerId === workerId && line.jobId && line.rate !== null && line.rate > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  for (const line of lines) {
    const jobId = line.jobId as string;
    if (!have.has(jobId) && !latest.has(jobId)) latest.set(jobId, { jobId, rate: line.rate as number, date: line.date });
  }
  return [...latest.values()];
}

/** The last rate this person got on job work, and on shop time: a reminder next to the boxes on the rate list. */
export function lastRates(pay: PayItem[], workerId: string): { work: { rate: number; date: string } | null; shop: { rate: number; date: string } | null } {
  const lines = pay
    .filter(isLine)
    .filter((line) => line.workerId === workerId && line.rate !== null && line.rate > 0)
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  const pick = (line: PayLine | undefined) => (line ? { rate: line.rate as number, date: line.date } : null);
  const isShop = (line: PayLine) => !line.jobId && line.what === SHOP_LABEL;
  return { work: pick(lines.find((line) => !isShop(line))), shop: pick(lines.find(isShop)) };
}
