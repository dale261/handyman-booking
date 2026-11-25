import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, CrewEntry, HoursEntry, JobRecord, ShopHoursEntry } from "@/lib/db/types";
import { checkHours, HOURS_LIMITS, hoursLabel, hoursRefusal, SHOP_LABEL, weekStart, weekTotals } from "@/lib/domain/hours";
import { appUrl, formatDate, todayDetroit } from "@/lib/format";
import { tellOwner } from "@/lib/services/booking";
import { leadCrew, leadsWorker, NOT_YOUR_CREW } from "@/lib/services/lead";
import { autoRate, dropPayFor, payLocked, repriceFor } from "@/lib/services/pay";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

export type HoursChange = {
  removed?: boolean;
  /** What the entry said before, when its hours were changed rather than added or removed. */
  was?: number;
  workerId: string;
  workerName: string;
  date: string;
  hours: number;
  note: string;
  /** The job the hours were on. Leave out for shop time. */
  job?: Pick<JobRecord, "id" | "scope" | "jobSiteAddress">;
  /** True when the hours have pay on them that came from the owner's rate list, or was worked out again after a change. */
  priced?: boolean;
};

/**
 * Email the owner each time a crew member logs hours, on a job or as shop time, takes
 * some back off, or (a crew lead) changes them, so the emails always add up to what the
 * Hours page shows. When a lead did it for someone on their crew, the email says who did
 * it and whose hours they are. Hours the owner enters send nothing: the owner already
 * knows. Nothing goes in the Queue, because there is nothing to act on.
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
    const short = what.length > 60 ? `${what.slice(0, 59)}…` : what;
    const who = change.workerName;
    // Someone else did it: a crew lead, for a person on their crew.
    const by = actor.workerId && actor.workerId !== change.workerId ? actor.fullName || "The crew lead" : "";
    const changed = change.was !== undefined && !change.removed;

    let title: string;
    let first: string;
    if (changed) {
      const doer = by || who;
      const whose = by ? `${who}'s` : "their";
      title = `${doer} changed ${whose} hours to ${amount} for ${day}: ${short}`;
      first = `${doer} changed ${whose} ${change.job ? `hours on ${what}` : "shop time"} for ${day} from ${hoursLabel(change.was ?? 0)} to ${amount}.`;
    } else if (by) {
      title = `${by} ${change.removed ? "removed" : "logged"} ${amount} for ${who}, ${day}: ${short}`;
      if (change.removed) first = change.job ? `${by} removed ${who}'s ${amount} from ${what} for ${day}.` : `${by} removed ${who}'s ${amount} of shop time for ${day}.`;
      else first = change.job ? `${by} logged ${amount} for ${who} on ${what} for ${day}.` : `${by} logged ${amount} of shop time for ${who} for ${day}.`;
    } else {
      title = `${who} ${change.removed ? "removed" : "logged"} ${amount} for ${day}: ${short}`;
      first = change.job
        ? `${who} ${change.removed ? `removed ${amount} from` : `logged ${amount} on`} ${what} for ${day}.`
        : `${who} ${change.removed ? "removed" : "logged"} ${amount} of shop time for ${day}.`;
    }

    const lines = [first];
    if (change.job?.jobSiteAddress) lines.push(`Job site: ${change.job.jobSiteAddress}`);
    if (change.note) lines.push(`Note: ${change.note}`);
    lines.push("", `${who}'s total for the week of ${formatDate(start)} is now ${hoursLabel(week)}, shop time included.`);
    lines.push("", `Everyone's hours: ${appUrl()}/owner/hours?week=${start}`);
    if (!change.removed) {
      const record = `${appUrl()}/owner/pay?who=${change.workerId}`;
      if (changed && change.priced) lines.push(`The pay on these hours was worked out again at the same rate. See it: ${record}`);
      else if (change.priced) lines.push(`The rate was filled in from your rate list. See it: ${record}`);
      else lines.push(`Set the rate for these hours: ${appUrl()}/owner/pay`);
    }
    await tellOwner(repo, settings, title, lines.join("\n"), change.job?.id ?? null);
  } catch (error) {
    console.error("[hours email] skipped", error);
  }
}

/**
 * Log hours worked on a job. A crew member logs their own, on any job in the app that
 * hours can go on: it does not have to be on their crew, or have a crew at all, because
 * people help on other crews' jobs and finished work is written up with nobody assigned.
 * A crew lead can also log for anyone on the crew they lead. The owner can log for anyone
 * on the crew list. Customers never can. Nothing about the job's price, status or
 * schedule changes. The owner is emailed.
 */
export async function addHours(
  repo: Repository,
  actor: Actor,
  jobId: string,
  input: { workerId?: string; date: string; hours: number; note: string },
): Promise<Ok<JobRecord> | Err> {
  // A crew lead can name someone on the crew they lead, and nobody else. Any other crew
  // member always logs their own, whatever the form says.
  let forOther = false;
  if (actor.role === "worker" && input.workerId && input.workerId !== actor.workerId) {
    const crew = await leadCrew(repo, actor);
    if (crew) {
      if (!crew.members.some((member) => member.id === input.workerId)) return fail(NOT_YOUR_CREW);
      forOther = true;
    }
  }
  const result = await repo.run(async (): Promise<(Ok<JobRecord> & { entry: HoursEntry }) | Err> => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role === "customer") return fail("Only the crew can log hours.");
    const refusal = hoursRefusal(job);
    if (refusal) return fail(refusal);

    const workers = await repo.listWorkers();
    const workerId = actor.role === "owner" || forOther ? (input.workerId ?? "") : (actor.workerId ?? "");
    const worker = workers.find((item) => item.id === workerId);
    if (!worker) return fail(actor.role === "owner" || forOther ? "Pick who worked the hours." : "Your sign-in isn't linked to a crew member yet. Ask the owner.");

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
  const priced = await autoRate(repo, { entryId: result.entry.id, workerId: result.entry.workerId, workerName: result.entry.workerName, date: result.entry.date, hours: result.entry.hours, note: result.entry.note, jobId: result.data.id, what: result.data.scope || "Job" });
  await hoursEmail(repo, actor, { ...result.entry, job: result.data, priced });
  return { ok: true, data: result.data };
}

/**
 * Take an entry back off. A crew member can remove their own, unless the owner has set
 * pay on it: then it is part of the pay record and only the owner can remove it. A rate
 * that was only filled in from the rate list doesn't count, so a wrong number can still
 * be fixed. A crew lead can remove any entry of someone on the crew they lead, and the
 * owner can remove any at all. Either way the pay line goes with the hours. The owner is
 * emailed.
 */
export async function removeHours(repo: Repository, actor: Actor, jobId: string, entryId: string): Promise<Ok<JobRecord> | Err> {
  const result = await repo.run(async (): Promise<(Ok<JobRecord> & { entry: HoursEntry }) | Err> => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role === "customer") return fail("Only the crew can change hours.");
    const entry = (job.hours ?? []).find((item) => item.id === entryId);
    if (!entry) return fail("That entry is already gone.");
    if (actor.role !== "owner" && !(await leadsWorker(repo, actor, entry.workerId))) {
      if (entry.workerId !== actor.workerId) return fail("You can only remove hours you logged yourself.");
      if (await payLocked(repo, entryId)) return fail("Pay has been set on those hours, so they stay on the record. Ask the owner to change them.");
    }
    job.hours = (job.hours ?? []).filter((item) => item.id !== entryId);
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }), entry };
  });
  if (!result.ok) return result;
  await dropPayFor(repo, entryId);
  await hoursEmail(repo, actor, { ...result.entry, removed: true, job: result.data });
  return { ok: true, data: result.data };
}

/** The new number for an entry whose hours are being changed: the same rules as a new entry, without the date. */
export function checkNewHours(value: number): { ok: true; hours: number } | Err {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < HOURS_LIMITS.min) return fail("Enter the hours, such as 3.5.");
  if (hours > HOURS_LIMITS.max) return fail(`That's more than ${HOURS_LIMITS.max} hours in one entry. Check the number.`);
  if (Math.abs(hours * 4 - Math.round(hours * 4)) > 1e-9) return fail("Use quarter hours: 1, 1.25, 1.5, 1.75.");
  return { ok: true, hours: Math.round(hours * 100) / 100 };
}

/**
 * Change how many hours an entry on a job says. For the owner, and for a crew lead on
 * entries of people on the crew they lead. The day, the person and the note stay. If the
 * hours have a rate on them, the pay is worked out again at that same rate. The owner is
 * emailed with the before and after.
 */
export async function changeHours(repo: Repository, actor: Actor, jobId: string, entryId: string, hours: number): Promise<Ok<JobRecord> | Err> {
  const checked = checkNewHours(hours);
  if (!checked.ok) return checked;
  const result = await repo.run(async (): Promise<(Ok<JobRecord> & { entry: HoursEntry; was: number }) | Err> => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    const list = job.hours ?? [];
    const entry = list.find((item) => item.id === entryId);
    if (!entry) return fail("That entry is already gone.");
    if (actor.role !== "owner" && !(actor.role === "worker" && (await leadsWorker(repo, actor, entry.workerId)))) return fail("Only the owner or that person's crew lead can change hours. You can remove yours and add them again.");
    const sameDay = list.filter((item) => item.id !== entryId && item.workerId === entry.workerId && item.date === entry.date).reduce((sum, item) => sum + item.hours, 0);
    if (sameDay + checked.hours > 24) return fail("That would put more than 24 hours on one day for this job. Check the number.");
    const was = entry.hours;
    const next: HoursEntry = { ...entry, hours: checked.hours };
    job.hours = list.map((item) => (item.id === entryId ? next : item));
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }), entry: next, was };
  });
  if (!result.ok) return result;
  const priced = await repriceFor(repo, entryId, result.entry.hours);
  if (result.was !== result.entry.hours) await hoursEmail(repo, actor, { ...result.entry, was: result.was, job: result.data, priced });
  return { ok: true, data: result.data };
}
