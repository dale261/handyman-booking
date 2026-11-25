import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, CrewPayment, CrewRate, PayItem, PayLine, PayMethod, ShopHoursEntry, WorkerRecord } from "@/lib/db/types";
import { checkFlatPay, checkPayment, checkRate, lineFor, loggedHours, payFor, RATE_EVERYONE, RATE_SHOP, RATE_USUAL, rateFor, rateId, type LoggedHours } from "@/lib/domain/pay";
import { todayDetroit } from "@/lib/format";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

const OWNER_ONLY = "Only the owner can see or change crew pay.";

/** A save that fails (the table isn't set up yet, say) becomes a plain message, not a crashed page. */
async function saved(work: Promise<void>): Promise<Err | null> {
  try {
    await work;
    return null;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "That couldn't be saved. Try again.");
  }
}

/** Anyone on the crew list can be paid, whether or not they are active or have a sign-in. */
async function person(repo: Repository, workerId: string): Promise<WorkerRecord | Err> {
  const worker = (await repo.listWorkers()).find((item) => item.id === workerId);
  return worker ?? fail("Pick who it's for.");
}

/**
 * Set the hourly rate on hours that are already logged in the app, or change it. The
 * crew logs the hours; the owner puts the rate on them, because the rate changes with
 * the job. The pay is hours times rate.
 *
 * With `remember`, the rate also goes on the rate list for that person on that job (or
 * for their shop time), so their next hours there get it without the owner doing anything.
 */
export async function setRate(repo: Repository, actor: Actor, entryId: string, rate: number, remember = false): Promise<(Ok<PayLine> & { remembered: boolean }) | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  const checked = checkRate(rate);
  if (!checked.ok) return fail(checked.error);
  const shop = (await repo.listCrewEntries()).filter((entry): entry is ShopHoursEntry => entry.kind === "shop_hours");
  const entry = loggedHours(await repo.listJobs(), shop).find((item) => item.entryId === entryId);
  if (!entry) return fail("Those hours aren't there any more.");
  const existing = lineFor(await repo.listPay(), entryId);
  const line: PayLine = {
    id: existing?.id ?? randomUUID(),
    kind: "pay",
    workerId: entry.workerId,
    workerName: entry.workerName,
    date: entry.date,
    hours: entry.hours,
    rate: checked.rate,
    amount: payFor(entry.hours, checked.rate),
    entryId,
    jobId: entry.jobId,
    what: entry.what,
    note: entry.note,
    at: new Date().toISOString(),
  };
  const problem = await saved(repo.savePayItem(line));
  if (problem) return problem;
  // The rate on the hours is saved either way. If the list can't take it, the owner is told.
  const kept = remember ? await saved(repo.saveRate(listRate(entry.workerId, entry.jobId ?? RATE_SHOP, checked.rate))) : null;
  return { ok: true, data: line, remembered: remember && !kept };
}

function listRate(workerId: string, scope: string, rate: number): CrewRate {
  return { id: rateId(workerId, scope), workerId, scope, rate, updatedAt: new Date().toISOString() };
}

/**
 * Put a rate on the owner's rate list, or take one off (a blank rate). `scope` is
 * "usual", "shop", or a job's id. Changing the list never changes hours already logged:
 * each of those keeps the rate it was given.
 */
export async function saveListRate(repo: Repository, actor: Actor, input: { workerId: string; scope: string; rate: number | null }): Promise<Ok<CrewRate | null> | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  const worker = await person(repo, input.workerId);
  if ("ok" in worker) return worker;
  if (input.scope !== RATE_USUAL && input.scope !== RATE_SHOP && !(await repo.getJob(input.scope))) return fail("Pick the job the rate is for.");
  if (input.rate === null) {
    const problem = await saved(repo.deleteRate(rateId(worker.id, input.scope)));
    return problem ?? { ok: true, data: null };
  }
  const checked = checkRate(input.rate);
  if (!checked.ok) return fail(checked.error);
  const rate = listRate(worker.id, input.scope, checked.rate);
  const problem = await saved(repo.saveRate(rate));
  return problem ?? { ok: true, data: rate };
}

/**
 * The shop time rate for everyone who has none of their own, or blank to take it off.
 * Someone new to the crew gets it from their first shop time, with nothing to set up.
 * Like the rest of the list, it never changes hours already logged.
 */
export async function saveShopDefault(repo: Repository, actor: Actor, rate: number | null): Promise<Ok<CrewRate | null> | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  if (rate === null) {
    const problem = await saved(repo.deleteRate(rateId(RATE_EVERYONE, RATE_SHOP)));
    return problem ?? { ok: true, data: null };
  }
  const checked = checkRate(rate);
  if (!checked.ok) return fail(checked.error);
  const made = listRate(RATE_EVERYONE, RATE_SHOP, checked.rate);
  const problem = await saved(repo.saveRate(made));
  return problem ?? { ok: true, data: made };
}

/**
 * As hours are logged, give them the rate the owner's list says, if it says one. The
 * crew member never sees it. The line is marked as filled in automatically so the owner
 * can tell, and he can change it. Never stops the hours from being saved.
 */
export async function autoRate(repo: Repository, entry: Omit<LoggedHours, "at">): Promise<boolean> {
  try {
    const listed = rateFor(await repo.listRates(), entry.workerId, entry.jobId);
    if (!listed) return false;
    if (lineFor(await repo.listPay(), entry.entryId)) return false;
    const line: PayLine = {
      id: randomUUID(),
      kind: "pay",
      workerId: entry.workerId,
      workerName: entry.workerName,
      date: entry.date,
      hours: entry.hours,
      rate: listed.rate,
      amount: payFor(entry.hours, listed.rate),
      entryId: entry.entryId,
      jobId: entry.jobId,
      what: entry.what,
      note: entry.note,
      at: new Date().toISOString(),
      auto: true,
    };
    await repo.savePayItem(line);
    return true;
  } catch (error) {
    console.error("[crew pay] couldn't fill in the rate from the list", error);
    return false;
  }
}

/**
 * Why a crew member can't be removed from the crew list, or null when they can: someone
 * with pay or payments on record has to stay, or their record would have no person.
 */
export async function payBlocksRemoval(repo: Repository, workerId: string): Promise<string | null> {
  const pay = await repo.listPay();
  if (!pay.some((item) => item.workerId === workerId)) return null;
  return "That person has pay on record, so they stay on the list. Untick Active to take them off the schedule.";
}

/** When someone is removed from the crew list, their lines on the rate list go too. */
export async function dropRatesFor(repo: Repository, workerId: string): Promise<void> {
  try {
    for (const rate of (await repo.listRates()).filter((item) => item.workerId === workerId)) await repo.deleteRate(rate.id);
  } catch (error) {
    console.error("[crew pay] couldn't clear the rate list for a removed worker", error);
  }
}

/** Pay that isn't by the hour: a flat amount for a job, a split, a bonus. It can name the job. */
export async function addFlatPay(
  repo: Repository,
  actor: Actor,
  input: { workerId: string; date: string; amount: number; what: string; jobId?: string },
): Promise<Ok<PayLine> | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  const worker = await person(repo, input.workerId);
  if ("ok" in worker) return worker;
  const checked = checkFlatPay(input, todayDetroit());
  if (!checked.ok) return fail(checked.error);
  let jobId: string | null = null;
  if (input.jobId) {
    const job = await repo.getJob(input.jobId);
    if (!job) return fail("That job isn't in the app. Pick another, or leave the job blank.");
    jobId = job.id;
  }
  const line: PayLine = {
    id: randomUUID(),
    kind: "pay",
    workerId: worker.id,
    workerName: worker.fullName,
    date: checked.date,
    hours: null,
    rate: null,
    amount: checked.amount,
    entryId: null,
    jobId,
    what: checked.what,
    note: "",
    at: new Date().toISOString(),
  };
  const problem = await saved(repo.savePayItem(line));
  if (problem) return problem;
  return { ok: true, data: line };
}

/** Money the owner paid someone. The app only records it; the money moves outside the app. */
export async function addPayment(
  repo: Repository,
  actor: Actor,
  input: { workerId: string; date: string; amount: number; note: string; method?: PayMethod },
): Promise<Ok<CrewPayment> | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  const worker = await person(repo, input.workerId);
  if ("ok" in worker) return worker;
  const checked = checkPayment(input, todayDetroit());
  if (!checked.ok) return fail(checked.error);
  const payment: CrewPayment = {
    id: randomUUID(),
    kind: "payment",
    workerId: worker.id,
    workerName: worker.fullName,
    date: checked.date,
    amount: checked.amount,
    ...(input.method ? { method: input.method } : {}),
    note: checked.note,
    at: new Date().toISOString(),
  };
  const problem = await saved(repo.savePayItem(payment));
  if (problem) return problem;
  return { ok: true, data: payment };
}

/** Take a pay line or a payment back off. Hours it was set on stay, and go back to needing a rate. */
export async function removePayItem(repo: Repository, actor: Actor, id: string): Promise<Ok<PayItem> | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  const item = await repo.getPayItem(id);
  if (!item) return fail("That line is already gone.");
  const problem = await saved(repo.deletePayItem(id));
  if (problem) return problem;
  return { ok: true, data: item };
}

/**
 * Add someone to pay who isn't on the crew list: a helper for a day, or a past worker.
 * They get no sign-in and no place on the schedule. Only a name is needed.
 */
export async function addPayPerson(repo: Repository, actor: Actor, name: string): Promise<Ok<WorkerRecord> | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  const fullName = name.replace(/\s+/g, " ").trim().slice(0, 80);
  if (fullName.length < 2) return fail("Enter their name.");
  const taken = (await repo.listWorkers()).find((worker) => worker.fullName.trim().toLowerCase() === fullName.toLowerCase());
  if (taken) return fail(`${taken.fullName} is already on the list.`);
  const worker: WorkerRecord = { id: randomUUID(), profileId: null, fullName, email: "", crewId: null, dayStartMin: 480, dayEndMin: 1020, workDays: [], active: false };
  const problem = await saved(repo.saveWorker(worker));
  if (problem) return problem;
  return { ok: true, data: worker };
}

/**
 * True when the owner has put pay on these hours himself: a rate he set, or a line from
 * his own records. A crew member can't take such hours back off; the owner can. A rate
 * that was only filled in from the rate list doesn't lock them, because that happens the
 * moment hours are logged and a crew member still has to be able to fix a wrong number:
 * the pay line goes with the hours. If the pay table can't be read, the hours are treated
 * as unlocked so a crew member is never stuck because of it.
 */
export async function payLocked(repo: Repository, entryId: string): Promise<boolean> {
  try {
    const line = lineFor(await repo.listPay(), entryId);
    return Boolean(line && !line.auto);
  } catch {
    return false;
  }
}

/** When hours are removed, the pay on them goes too, so nobody is owed for hours that aren't there. */
export async function dropPayFor(repo: Repository, entryId: string): Promise<void> {
  try {
    const line = lineFor(await repo.listPay(), entryId);
    if (line) await repo.deletePayItem(line.id);
  } catch (error) {
    console.error("[crew pay] couldn't drop the pay line for removed hours", error);
  }
}
