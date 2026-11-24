import type { CrewPayment, JobRecord, PayItem, PayLine, PayMethod, WorkerRecord } from "@/lib/db/types";
import { addDays, isDate, SHOP_LABEL } from "@/lib/domain/hours";
import { roundCents } from "@/lib/domain/money";
import { balances, payFor, PAY_LIMITS, readMethod, type LoggedHours } from "@/lib/domain/pay";

/**
 * Loading the owner's own pay records from a file: one line per day worked or payment
 * made, with the columns date, worker, job, job_number, hours, rate, pay, note. The file
 * is read, checked against what is already on the site, shown to the owner, and only
 * then saved. Loading again replaces what was loaded before, so a newer file is safe.
 */
export const LOAD_LIMITS = { chars: 300_000, rows: 3000, shown: 20 };

/** A small CSV reader: commas, quoted cells, doubled quotes, either kind of line ending. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim() !== ""));
}

export type FileRow = {
  /** Its place in the file, counting the heading as line 1. */
  line: number;
  /** Hours at a rate; a flat amount; a payment to the person; or hours tracked with no pay. */
  kind: "hourly" | "flat" | "payment" | "tracked";
  date: string;
  worker: string;
  job: string;
  jobNumber: string;
  hours: number | null;
  rate: number | null;
  /** Dollars earned, or dollars paid for a payment. Never negative. */
  amount: number;
  note: string;
  /** How a payment was made, when the file has a "method" column that says. It is never guessed from the note. */
  method?: PayMethod;
};

export type FileRead = {
  rows: FileRow[];
  problems: string[];
  warnings: string[];
  /** Lines in the file under the heading, usable or not. */
  lines: number;
};

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** A number cell: blank is null, "$1,250.50" is 1250.5, anything else that isn't a number is NaN. */
function num(cell: string): number | null {
  const raw = cell.replace(/[$,\s]/g, "");
  if (raw === "") return null;
  return /^-?\d*\.?\d+$/.test(raw) ? Number(raw) : Number.NaN;
}

/** Read the file into rows, with a plain message for every line that can't be used. */
export function readPayFile(text: string, today: string): FileRead {
  const problems: string[] = [];
  const warnings: string[] = [];
  const table = parseCsv(text);
  const lines = Math.max(0, table.length - 1);
  if (table.length === 0) return { rows: [], problems: ["The file is empty."], warnings, lines };
  const head = table[0].map((name) => name.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (name: string) => head.indexOf(name);
  const at = { date: col("date"), worker: col("worker"), job: col("job"), jobNumber: col("job_number"), hours: col("hours"), rate: col("rate"), pay: col("pay"), note: col("note"), method: col("method") };
  const missing = (["date", "worker", "job", "hours", "rate", "pay"] as const).filter((name) => at[name] === -1);
  if (missing.length > 0) {
    return { rows: [], problems: [`The first line has to name the columns. Missing: ${missing.join(", ")}. Expected: date, worker, job, job_number, hours, rate, pay, note.`], warnings, lines };
  }
  if (lines > LOAD_LIMITS.rows) return { rows: [], problems: [`The file has more than ${LOAD_LIMITS.rows} lines. Split it up.`], warnings, lines };

  const rows: FileRow[] = [];
  table.slice(1).forEach((cells, index) => {
    const line = index + 2;
    const get = (i: number) => (i === -1 ? "" : (cells[i] ?? "").trim());
    const bad = (message: string) => problems.push(`Line ${line}: ${message}`);
    const date = get(at.date);
    const worker = get(at.worker).replace(/\s+/g, " ");
    const job = get(at.job).replace(/\s+/g, " ");
    const hours = num(get(at.hours));
    const rate = num(get(at.rate));
    const pay = num(get(at.pay));
    if (!isDate(date)) return bad(`the day "${date}" isn't a date written like 2026-11-20.`);
    if (date > today) return bad(`${date} hasn't happened yet.`);
    if (date < addDays(today, -PAY_LIMITS.daysBack)) return bad(`${date} is more than two years back.`);
    if (!worker) return bad("there's no name in the worker column.");
    if (Number.isNaN(hours) || Number.isNaN(rate) || Number.isNaN(pay)) return bad("hours, rate and pay have to be numbers or blank.");
    if (hours !== null && (hours <= 0 || hours > 24)) return bad(`${hours} hours in one day doesn't look right.`);
    if (rate !== null && (rate < 0 || rate > PAY_LIMITS.rateMax)) return bad(`a rate of ${rate} doesn't look right.`);
    if (pay !== null && Math.abs(pay) > PAY_LIMITS.amountMax) return bad(`an amount of ${pay} doesn't look right.`);
    const base = { line, date, worker, job, jobNumber: get(at.jobNumber).replace(/\s+/g, " "), note: get(at.note).replace(/\s+/g, " ").slice(0, PAY_LIMITS.textMax) };

    if (job.toLowerCase() === "payment") {
      if (pay === null || pay === 0) return bad("a payment needs an amount in the pay column.");
      const method = readMethod(get(at.method));
      rows.push({ ...base, kind: "payment", hours: null, rate: null, amount: roundCents(Math.abs(pay)), ...(method ? { method } : {}) });
    } else if (hours !== null && rate !== null) {
      if (pay !== null && pay < 0) return bad("pay can't be negative on a line with hours.");
      const worked = payFor(hours, rate);
      const amount = pay === null ? worked : roundCents(pay);
      // A cent either way is rounding. More than that is worth the owner's eye; the file's amount still wins.
      if (Math.abs(amount - worked) > 0.011) warnings.push(`Line ${line}: pay of ${money(amount)} isn't ${hours} hours at ${money(rate)} (${money(worked)}). The file's amount is kept.`);
      rows.push({ ...base, kind: "hourly", hours, rate: roundCents(rate), amount });
    } else if (hours !== null && pay === null) {
      rows.push({ ...base, kind: "tracked", hours, rate: 0, amount: 0 });
    } else if (pay !== null && pay > 0) {
      rows.push({ ...base, kind: "flat", hours, rate: null, amount: roundCents(pay) });
    } else {
      bad("it has no hours and no pay, so there's nothing to load.");
    }
  });
  return { rows, problems, warnings, lines };
}

type Named = Pick<WorkerRecord, "id" | "fullName">;

/**
 * Which crew member a name in the file most likely is: the same full name, else the one
 * person with that first name, else the one person with that word in their name, else the
 * one person whose name contains it (a nickname like "Ski"). Null when it isn't clear.
 * It is only a first guess. The owner sees every match and can change it.
 */
export function guessPerson(name: string, workers: Named[]): string | null {
  const want = name.trim().toLowerCase();
  if (!want) return null;
  const words = (worker: Named) => worker.fullName.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
  const only = (list: Named[]) => (list.length === 1 ? list[0].id : null);
  const exact = workers.filter((worker) => worker.fullName.trim().toLowerCase() === want);
  if (exact.length > 0) return only(exact);
  const first = workers.filter((worker) => words(worker)[0] === want);
  if (first.length > 0) return only(first);
  const word = workers.filter((worker) => words(worker).includes(want));
  if (word.length > 0) return only(word);
  if (want.length < 3) return null;
  return only(workers.filter((worker) => worker.fullName.toLowerCase().includes(want)));
}

/** The choice that means "this person isn't on the crew list: add them by name". */
export const NEW_PERSON = "new";

/** Who each name in the file is: a crew member's id, or NEW_PERSON. */
export type LoadChoices = Record<string, string>;

export type LoadPlan = {
  /** Lines read from the file. */
  read: number;
  /** Lines that can't be used. Nothing is loaded while there are any. */
  problems: string[];
  /** Things worth the owner's eye that don't stop the load. */
  warnings: string[];
  people: { name: string; choice: string; rows: number }[];
  jobs: { number: number; label: string; found: { scope: string; where: string } | null; rows: number }[];
  counts: {
    hourly: number;
    flat: number;
    payments: number;
    tracked: number;
    /** Lines that match hours already logged on the site: the rate goes on those hours, nothing is added twice. */
    linked: number;
    /** Lines already on the site (a rate the owner set, a payment he recorded): left as they are. */
    skipped: number;
    /** Lines from an earlier load, which this load replaces. */
    replaced: number;
    /** Lines this load saves. */
    adding: number;
  };
  /** Everyone's standing once this is loaded, most owed first. */
  after: { name: string; earned: number; paid: number; owed: number }[];
  /** What gets saved. Lines for people still to be added carry "new:<name>" as the worker id. */
  items: PayItem[];
  /** Lines from an earlier load that aren't in this one, to remove. */
  stale: string[];
  /** Names to add to the crew list as people with no sign-in. */
  newPeople: string[];
};

/** What the owner's screen needs: the plan without the lines themselves, plus the crew list to pick from. */
export type LoadSummary = Omit<LoadPlan, "items" | "stale"> & { crew: { id: string; fullName: string; active: boolean }[] };

function label(row: FileRow): string {
  if (row.job.toLowerCase() === "shop time") return SHOP_LABEL;
  const text = !row.jobNumber ? row.job : row.job && !row.jobNumber.toLowerCase().includes(row.job.toLowerCase()) ? `${row.job} · ${row.jobNumber}` : row.jobNumber;
  const tidy = text || "Work";
  return (tidy.charAt(0).toUpperCase() + tidy.slice(1)).slice(0, PAY_LIMITS.textMax);
}

function invoiceNumber(cell: string): number | null {
  const found = cell.match(/\d{3,7}/);
  return found ? Number(found[0]) : null;
}

/**
 * Work out what loading the file would do, without saving anything.
 *
 * - Each name is matched to a crew member (the owner's choice, else a guess, else new).
 * - A job number is matched to the app's job with that invoice number, when there is one.
 * - Hours that are already logged on the site get the file's rate put on them, not a second entry.
 * - A rate the owner already set, or a payment he already recorded, is left alone.
 * - Everything loaded before is replaced, so a newer file never doubles an older one.
 * - The file's pay amount is kept as written, not worked out again.
 */
export function planLoad(input: {
  file: FileRead;
  workers: (Named & { active?: boolean })[];
  jobs: Pick<JobRecord, "id" | "scope" | "invoiceNumber" | "jobSiteAddress">[];
  logged: LoggedHours[];
  pay: PayItem[];
  choices: LoadChoices;
  makeId: (key: string) => string;
  now: Date;
}): LoadPlan {
  const { file, workers, jobs, logged, pay, choices, makeId, now } = input;
  const byId = new Map(workers.map((worker) => [worker.id, worker]));
  const jobByNumber = new Map(jobs.filter((job) => job.invoiceNumber != null).map((job) => [job.invoiceNumber as number, job]));
  // What the owner did on the site stays. What an earlier load put in is replaced.
  const site = pay.filter((item) => !item.loaded);
  const before = pay.filter((item) => item.loaded);

  const people = new Map<string, { name: string; choice: string; rows: number }>();
  for (const row of file.rows) {
    const key = row.worker.toLowerCase();
    const known = people.get(key);
    if (known) {
      known.rows += 1;
      continue;
    }
    const asked = choices[row.worker];
    const choice = asked === NEW_PERSON || (asked && byId.has(asked)) ? asked : (guessPerson(row.worker, workers) ?? NEW_PERSON);
    people.set(key, { name: row.worker, choice, rows: 1 });
  }

  const jobList = new Map<number, LoadPlan["jobs"][number]>();
  const counts = { hourly: 0, flat: 0, payments: 0, tracked: 0, linked: 0, skipped: 0, replaced: before.length, adding: 0 };
  const warnings = [...file.warnings];
  const items: PayItem[] = [];
  const seen = new Map<string, number>();
  const claimedEntries = new Set<string>();
  const claimedSite = new Set<string>();

  file.rows.forEach((row, index) => {
    const person = people.get(row.worker.toLowerCase());
    if (!person) return;
    const worker = person.choice === NEW_PERSON ? undefined : byId.get(person.choice);
    const workerId = worker ? worker.id : `new:${person.name}`;
    const workerName = worker ? worker.fullName : person.name;
    const key = [row.kind, row.date, row.worker.toLowerCase(), row.job.toLowerCase(), row.jobNumber.toLowerCase(), row.hours ?? "", row.rate ?? "", row.amount].join("|");
    const nth = (seen.get(key) ?? 0) + 1;
    seen.set(key, nth);
    const id = makeId(`${key}|${nth}`);
    const at = new Date(now.getTime() + index).toISOString();

    if (row.kind === "payment") {
      counts.payments += 1;
      const same = site.find((item) => item.kind === "payment" && !claimedSite.has(item.id) && item.workerId === workerId && item.date === row.date && item.amount === row.amount);
      if (same) {
        claimedSite.add(same.id);
        counts.skipped += 1;
        return;
      }
      const payment: CrewPayment = { id, kind: "payment", workerId, workerName, date: row.date, amount: row.amount, ...(row.method ? { method: row.method } : {}), note: row.note, at, loaded: true };
      items.push(payment);
      return;
    }

    const number = row.jobNumber ? invoiceNumber(row.jobNumber) : null;
    const job = number !== null ? jobByNumber.get(number) : undefined;
    if (number !== null) {
      const listed = jobList.get(number) ?? { number, label: row.jobNumber, found: job ? { scope: job.scope || "Job", where: job.jobSiteAddress || "" } : null, rows: 0 };
      listed.rows += 1;
      jobList.set(number, listed);
    }
    const line: PayLine = { id, kind: "pay", workerId, workerName, date: row.date, hours: row.hours, rate: row.rate, amount: row.amount, entryId: null, jobId: job?.id ?? null, what: label(row), note: row.note, at, loaded: true };

    if (row.kind === "flat") {
      counts.flat += 1;
      const same = site.find((item) => item.kind === "pay" && item.rate === null && !claimedSite.has(item.id) && item.workerId === workerId && item.date === row.date && item.amount === row.amount);
      if (same) {
        claimedSite.add(same.id);
        counts.skipped += 1;
        return;
      }
      items.push(line);
      return;
    }

    if (row.kind === "hourly") counts.hourly += 1;
    else counts.tracked += 1;
    // Are these hours already logged on the site? Same person, same day, same hours, and the same job (or shop time).
    const isShop = line.what === SHOP_LABEL;
    const entry = worker
      ? logged.find(
          (item) =>
            !claimedEntries.has(item.entryId) &&
            item.workerId === worker.id &&
            item.date === row.date &&
            Math.abs(item.hours - (row.hours ?? 0)) < 0.001 &&
            (isShop ? item.jobId === null : Boolean(job) && item.jobId === job?.id),
        )
      : undefined;
    if (entry) {
      claimedEntries.add(entry.entryId);
      const set = site.find((item) => item.kind === "pay" && item.entryId === entry.entryId);
      if (set) {
        counts.skipped += 1;
        if (set.kind === "pay" && set.rate !== row.rate) warnings.push(`Line ${row.line}: ${workerName} on ${row.date} has ${money(set.rate ?? 0)} an hour on the site and ${money(row.rate ?? 0)} in the file. The site's rate was kept.`);
        return;
      }
      counts.linked += 1;
      items.push({ ...line, entryId: entry.entryId, jobId: entry.jobId });
      return;
    }
    items.push(line);
  });

  counts.adding = items.length;
  const keep = new Set(items.map((item) => item.id));
  const after = balances([...site, ...items]).map((person) => ({ name: person.workerName, earned: person.earned, paid: person.paid, owed: person.owed }));
  return {
    read: file.lines,
    problems: file.problems,
    warnings,
    people: [...people.values()],
    jobs: [...jobList.values()].sort((a, b) => a.number - b.number),
    counts,
    after,
    items,
    stale: before.filter((item) => !keep.has(item.id)).map((item) => item.id),
    newPeople: [...people.values()].filter((person) => person.choice === NEW_PERSON).map((person) => person.name),
  };
}
