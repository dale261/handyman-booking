import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, CrewPayment, PayItem, PayLine, ShopHoursEntry, WorkerRecord } from "@/lib/db/types";
import { checkFlatPay, checkPayment, checkRate, lineFor, loggedHours, payFor } from "@/lib/domain/pay";
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
 */
export async function setRate(repo: Repository, actor: Actor, entryId: string, rate: number): Promise<Ok<PayLine> | Err> {
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
  return { ok: true, data: line };
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
  input: { workerId: string; date: string; amount: number; note: string },
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
 * True when pay has been set on these hours. A crew member can't take such hours back
 * off; the owner can. If the pay table can't be read, the hours are treated as unpriced
 * so a crew member is never stuck because of it.
 */
export async function hasPay(repo: Repository, entryId: string): Promise<boolean> {
  try {
    return Boolean(lineFor(await repo.listPay(), entryId));
  } catch {
    return false;
  }
}

/** When the owner removes hours, the pay set on them goes too, so nobody is owed for hours that aren't there. */
export async function dropPayFor(repo: Repository, entryId: string): Promise<void> {
  try {
    const line = lineFor(await repo.listPay(), entryId);
    if (line) await repo.deletePayItem(line.id);
  } catch (error) {
    console.error("[crew pay] couldn't drop the pay line for removed hours", error);
  }
}
