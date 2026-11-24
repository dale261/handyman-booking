import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, CrewEntry, HoursEntry, JobRecord, ShopHoursEntry } from "@/lib/db/types";
import { checkHours, HOURS_LIMITS, hoursLabel, hoursRefusal, SHOP_LABEL, weekStart, weekTotals } from "@/lib/domain/hours";
import { appUrl, formatDate, todayDetroit } from "@/lib/format";
import { tellOwner } from "@/lib/services/booking";
import { dropPayFor, hasPay } from "@/lib/services/pay";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

export type HoursChange = {
  removed?: boolean;
  workerId: string;
  workerName: string;
  date: string;
  hours: number;
  note: string;
  /** The job the hours were on. Leave out for shop time. */
  job?: Pick<JobRecord, "id" | "scope" | "jobSiteAddress">;
};

/**
 * Email the owner each time a crew member logs hours, on a job or as shop time, or takes
 * some back off, so the emails always add up to what the Hours page shows. Hours the
 * owner enters send nothing: the owner already knows. Nothing goes in the Queue, because there
 * is nothing to act on.
 *
 * The hours are already saved when this runs. If the email can't be put together it is
 * skipped, never the hours.
 */
export async function hoursEmail(repo: Repository, actor: Actor, change: HoursChange): Promise<void> {
  if (actor.role === "owner") return;
  try {
    const settings = await repo.getSettings();
    const start = weekStart(change.date);
    // Shop time lives in its own table. If that can't be read, the week total is job hours only rather than no email.
    const entries: CrewEntry[] = await repo.listCrewEntries().catch(() => []);
    const shop = entries.filter((entry): entry is ShopHoursEntry => entry.kind === "shop_hours");
    const week = weekTotals(await repo.listJobs(), start, shop).find((person) => person.workerId === change.workerId)?.total ?? 0;

    const amount = hoursLabel(change.hours);
    const day = formatDate(change.date);
    const what = change.job ? change.job.scope || "Job" : SHOP_LABEL;
    const title = `${change.workerName} ${change.removed ? "removed" : "logged"} ${amount} for ${day}: ${what.length > 60 ? `${what.slice(0, 59)}…` : what}`;
    const lines = [
      change.job
        ? `${change.workerName} ${change.removed ? `removed ${amount} from` : `logged ${amount} on`} ${what} for ${day}.`
        : `${change.workerName} ${change.removed ? "removed" : "logged"} ${amount} of shop time for ${day}.`,
    ];
    if (change.job?.jobSiteAddress) lines.push(`Job site: ${change.job.jobSiteAddress}`);
    if (change.note) lines.push(`Note: ${change.note}`);
    lines.push("", `${change.workerName}'s total for the week of ${formatDate(start)} is now ${hoursLabel(week)}, shop time included.`);
    lines.push("", `Everyone's hours: ${appUrl()}/owner/hours?week=${start}`);
    if (!change.removed) lines.push(`Set the rate for these hours: ${appUrl()}/owner/pay`);
    await tellOwner(repo, settings, title, lines.join("\n"), change.job?.id ?? null);
  } catch (error) {
    console.error("[hours email] skipped", error);
  }
}

/**
 * Log hours worked on a job. A crew member logs their own, on any job in the app that
 * hours can go on: it does not have to be on their crew, or have a crew at all, because
 * people help on other crews' jobs and finished work is written up with nobody assigned.
 * The owner can log for anyone on the crew list. Customers never can. Nothing about
 * the job's price, status or schedule changes. The owner is emailed.
 */
export async function addHours(
  repo: Repository,
  actor: Actor,
  jobId: string,
  input: { workerId?: string; date: string; hours: number; note: string },
): Promise<Ok<JobRecord> | Err> {
  const result = await repo.run(async (): Promise<(Ok<JobRecord> & { entry: HoursEntry }) | Err> => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role === "customer") return fail("Only the crew can log hours.");
    const refusal = hoursRefusal(job);
    if (refusal) return fail(refusal);

    const workers = await repo.listWorkers();
    const workerId = actor.role === "owner" ? (input.workerId ?? "") : (actor.workerId ?? "");
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) return fail(actor.role === "owner" ? "Pick who worked the hours." : "Your sign-in isn't linked to a crew member yet. Ask the owner.");

    const checked = checkHours({ date: input.date, hours: input.hours, note: input.note }, todayDetroit());
    if (!checked.ok) return fail(checked.error);
    const hours = job.hours ?? [];
    if (hours.length >= HOURS_LIMITS.perJob) return fail("This job has too many hour entries. Ask the owner to tidy it up.");
    const sameDay = hours.filter((entry) => entry.workerId === worker.id && entry.date === checked.date).reduce((sum, entry) => sum + entry.hours, 0);
    if (sameDay + checked.hours > 24) return fail("That would put more than 24 hours on one day for this job. Check the day and the number.");

    const entry: HoursEntry = { id: randomUUID(), workerId: worker.id, workerName: worker.fullName, date: checked.date, hours: checked.hours, note: checked.note, at: new Date().toISOString() };
    job.hours = [...hours, entry];
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }), entry };
  });
  if (!result.ok) return result;
  await hoursEmail(repo, actor, { ...result.entry, job: result.data });
  return { ok: true, data: result.data };
}

/**
 * Take an entry back off. A crew member can remove their own, unless pay has been set
 * on it: then it is part of the pay record and only the owner can remove it, which
 * takes the pay line off with it. The owner is emailed.
 */
export async function removeHours(repo: Repository, actor: Actor, jobId: string, entryId: string): Promise<Ok<JobRecord> | Err> {
  const result = await repo.run(async (): Promise<(Ok<JobRecord> & { entry: HoursEntry }) | Err> => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role === "customer") return fail("Only the crew can change hours.");
    const entry = (job.hours ?? []).find((item) => item.id === entryId);
    if (!entry) return fail("That entry is already gone.");
    if (actor.role !== "owner" && entry.workerId !== actor.workerId) return fail("You can only remove hours you logged yourself.");
    if (actor.role !== "owner" && (await hasPay(repo, entryId))) return fail("Pay has been set on those hours, so they stay on the record. Ask the owner to change them.");
    job.hours = (job.hours ?? []).filter((item) => item.id !== entryId);
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }), entry };
  });
  if (!result.ok) return result;
  await dropPayFor(repo, entryId);
  await hoursEmail(repo, actor, { ...result.entry, removed: true, job: result.data });
  return { ok: true, data: result.data };
}
