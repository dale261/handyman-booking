import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, CrewEntry, ExpenseEntry, ShopHoursEntry, WorkerRecord } from "@/lib/db/types";
import { checkExpense } from "@/lib/domain/expenses";
import { canLogHours, checkHours, SHOP_LABEL } from "@/lib/domain/hours";
import { todayDetroit, usd } from "@/lib/format";
import { notify, visibleTo } from "@/lib/services/booking";
import { checkNewHours, hoursEmail } from "@/lib/services/hours";
import { leadCrew, leadsWorker, NOT_YOUR_CREW } from "@/lib/services/lead";
import { autoRate, dropPayFor, payLocked, repriceFor } from "@/lib/services/pay";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

/** A save that fails (the table isn't set up yet, say) becomes a plain message, not a crashed page. */
async function saved(work: Promise<void>): Promise<Err | null> {
  try {
    await work;
    return null;
  } catch (error) {
    return fail(error instanceof Error ? error.message : "That couldn't be saved. Try again.");
  }
}

/**
 * A crew member acts for themselves, whatever the form says. The owner has to say who
 * it's for. With `leadToo` (shop time, not receipts) a crew lead can also name someone on
 * the crew they lead, and nobody else.
 */
async function whoFor(repo: Repository, actor: Actor, workerId: string | undefined, leadToo = false): Promise<WorkerRecord | Err> {
  if (actor.role === "customer") return fail("Only the crew can use this.");
  let forOther = false;
  if (leadToo && actor.role === "worker" && workerId && workerId !== actor.workerId) {
    const crew = await leadCrew(repo, actor);
    if (crew) {
      if (!crew.members.some((member) => member.id === workerId)) return fail(NOT_YOUR_CREW);
      forOther = true;
    }
  }
  const workers = await repo.listWorkers();
  const id = actor.role === "owner" || forOther ? (workerId ?? "") : (actor.workerId ?? "");
  const worker = workers.find((item) => item.id === id);
  if (!worker) return fail(actor.role === "owner" || forOther ? "Pick who it's for." : "Your sign-in isn't linked to a crew member yet. Ask the owner.");
  return worker;
}

/**
 * Time worked that wasn't on a job: loading up, cleaning tools, a supply run. A crew
 * member adds their own, a crew lead can add it for someone on their crew, and the owner
 * for anyone. The owner is emailed.
 */
export async function addShopHours(
  repo: Repository,
  actor: Actor,
  input: { workerId?: string; date: string; hours: number; note: string },
): Promise<Ok<ShopHoursEntry> | Err> {
  const worker = await whoFor(repo, actor, input.workerId, true);
  if ("ok" in worker) return worker;
  const checked = checkHours({ date: input.date, hours: input.hours, note: input.note }, todayDetroit());
  if (!checked.ok) return fail(checked.error);
  const sameDay = (await repo.listCrewEntries())
    .filter((entry): entry is ShopHoursEntry => entry.kind === "shop_hours" && entry.workerId === worker.id && entry.date === checked.date)
    .reduce((sum, entry) => sum + entry.hours, 0);
  if (sameDay + checked.hours > 24) return fail("That would put more than 24 hours of shop time on one day. Check the day and the number.");
  const entry: ShopHoursEntry = {
    id: randomUUID(),
    kind: "shop_hours",
    workerId: worker.id,
    workerName: worker.fullName,
    date: checked.date,
    hours: checked.hours,
    note: checked.note,
    at: new Date().toISOString(),
  };
  const problem = await saved(repo.saveCrewEntry(entry));
  if (problem) return problem;
  const priced = await autoRate(repo, { entryId: entry.id, workerId: entry.workerId, workerName: entry.workerName, date: entry.date, hours: entry.hours, note: entry.note, jobId: null, what: SHOP_LABEL });
  await hoursEmail(repo, actor, { ...entry, priced });
  return { ok: true, data: entry };
}

/**
 * A receipt for something a crew member paid for. It can name the job it was for, and
 * carry a photo of the receipt. The owner is told, and pays it back outside the app.
 */
export async function addExpense(
  repo: Repository,
  actor: Actor,
  input: { workerId?: string; date: string; amount: number; what: string; jobId?: string; photoId?: string },
): Promise<Ok<ExpenseEntry> | Err> {
  const worker = await whoFor(repo, actor, input.workerId);
  if ("ok" in worker) return worker;
  const checked = checkExpense({ date: input.date, amount: input.amount, what: input.what }, todayDetroit());
  if (!checked.ok) return fail(checked.error);

  let jobId: string | null = null;
  let jobScope = "";
  if (input.jobId) {
    const job = await repo.getJob(input.jobId);
    // Any job hours can go on can take a receipt too, whichever crew it is on.
    if (!job || !(canLogHours(job) || (await visibleTo(repo, actor, job)))) return fail("That job isn't on your list. Pick another, or leave the job blank.");
    jobId = job.id;
    jobScope = job.scope || "Job";
  }
  const photoId = input.photoId && /^[0-9a-f-]{36}$/i.test(input.photoId) ? input.photoId : null;

  const entry: ExpenseEntry = {
    id: randomUUID(),
    kind: "expense",
    workerId: worker.id,
    workerName: worker.fullName,
    date: checked.date,
    amount: checked.amount,
    what: checked.what,
    jobId,
    jobScope,
    photoId,
    reimbursedAt: null,
    at: new Date().toISOString(),
  };
  const problem = await saved(repo.saveCrewEntry(entry));
  if (problem) return problem;
  if (actor.role !== "owner") {
    const settings = await repo.getSettings();
    await notify(
      repo,
      settings,
      "approval",
      `Receipt to reimburse: ${usd(entry.amount)} to ${entry.workerName}`,
      `${entry.workerName} paid ${usd(entry.amount)} for ${entry.what}${jobScope ? ` (${jobScope})` : ""}.${photoId ? " A photo of the receipt is saved with it." : " No photo was added."} Open Receipts in the owner menu to see it and mark it paid back.`,
      jobId,
    );
  }
  return { ok: true, data: entry };
}

/**
 * Take an entry back off. A crew member can remove their own, except a receipt that has
 * already been paid back or shop time the owner has set pay on: those are part of the
 * record. Shop time whose rate was only filled in from the rate list can still be
 * removed, and its pay line goes with it. A crew lead can remove shop time of anyone on
 * the crew they lead (never their receipts). The owner can remove any.
 */
export async function removeCrewEntry(repo: Repository, actor: Actor, id: string): Promise<Ok<CrewEntry> | Err> {
  if (actor.role === "customer") return fail("Only the crew can change this.");
  const entry = await repo.getCrewEntry(id);
  if (!entry) return fail("That entry is already gone.");
  if (actor.role !== "owner" && !(entry.kind === "shop_hours" && (await leadsWorker(repo, actor, entry.workerId)))) {
    if (entry.workerId !== actor.workerId) return fail("You can only remove entries you added yourself.");
    if (entry.kind === "expense" && entry.reimbursedAt) return fail("That receipt has been paid back, so it stays on the record.");
    if (entry.kind === "shop_hours" && (await payLocked(repo, id))) return fail("Pay has been set on those hours, so they stay on the record. Ask the owner to change them.");
  }
  const problem = await saved(repo.deleteCrewEntry(id));
  if (problem) return problem;
  if (entry.kind === "shop_hours") {
    await dropPayFor(repo, id);
    await hoursEmail(repo, actor, { ...entry, removed: true });
  }
  return { ok: true, data: entry };
}

/**
 * Change how many hours a shop time entry says. For the owner, and for a crew lead on
 * entries of people on the crew they lead. If the hours have a rate on them, the pay is
 * worked out again at that same rate. The owner is emailed with the before and after.
 */
export async function changeShopHours(repo: Repository, actor: Actor, id: string, hours: number): Promise<Ok<ShopHoursEntry> | Err> {
  const checked = checkNewHours(hours);
  if (!checked.ok) return checked;
  const entry = await repo.getCrewEntry(id);
  if (!entry || entry.kind !== "shop_hours") return fail("That entry is already gone.");
  if (actor.role !== "owner" && !(actor.role === "worker" && (await leadsWorker(repo, actor, entry.workerId)))) return fail("Only the owner or that person's crew lead can change hours. You can remove yours and add them again.");
  const sameDay = (await repo.listCrewEntries())
    .filter((item): item is ShopHoursEntry => item.kind === "shop_hours" && item.id !== id && item.workerId === entry.workerId && item.date === entry.date)
    .reduce((sum, item) => sum + item.hours, 0);
  if (sameDay + checked.hours > 24) return fail("That would put more than 24 hours of shop time on one day. Check the number.");
  const next: ShopHoursEntry = { ...entry, hours: checked.hours };
  const problem = await saved(repo.saveCrewEntry(next));
  if (problem) return problem;
  const priced = await repriceFor(repo, id, next.hours);
  if (entry.hours !== next.hours) await hoursEmail(repo, actor, { ...next, was: entry.hours, priced });
  return { ok: true, data: next };
}

/** Owner only: mark a receipt paid back, or undo that. */
export async function setReimbursed(repo: Repository, actor: Actor, id: string, done: boolean): Promise<Ok<ExpenseEntry> | Err> {
  if (actor.role !== "owner") return fail("Only the owner can mark a receipt paid back.");
  const entry = await repo.getCrewEntry(id);
  if (!entry || entry.kind !== "expense") return fail("That receipt is gone.");
  const next: ExpenseEntry = { ...entry, reimbursedAt: done ? new Date().toISOString() : null };
  const problem = await saved(repo.saveCrewEntry(next));
  if (problem) return problem;
  return { ok: true, data: next };
}
