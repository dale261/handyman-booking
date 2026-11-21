import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, JobRecord } from "@/lib/db/types";
import { checkHours, HOURS_LIMITS, HOURS_STATUSES } from "@/lib/domain/hours";
import { todayDetroit } from "@/lib/format";
import { visibleTo } from "@/lib/services/booking";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

/**
 * Log hours worked on a job. A crew member logs their own, on a job that is theirs.
 * The owner can log for anyone on the crew list. Customers never can. Nothing about
 * the job's price, status or schedule changes.
 */
export async function addHours(
  repo: Repository,
  actor: Actor,
  jobId: string,
  input: { workerId?: string; date: string; hours: number; note: string },
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role === "customer") return fail("Only the crew can log hours.");
    if (!(await visibleTo(repo, actor, job))) return fail("This job isn't on your list.");
    if (!HOURS_STATUSES.includes(job.status)) return fail("Hours can be logged once the job is booked.");

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

    job.hours = [
      ...hours,
      { id: randomUUID(), workerId: worker.id, workerName: worker.fullName, date: checked.date, hours: checked.hours, note: checked.note, at: new Date().toISOString() },
    ];
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }) };
  });
}

/** Take an entry back off. A crew member can remove their own; the owner can remove any. */
export async function removeHours(repo: Repository, actor: Actor, jobId: string, entryId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role === "customer") return fail("Only the crew can change hours.");
    const entry = (job.hours ?? []).find((item) => item.id === entryId);
    if (!entry) return fail("That entry is already gone.");
    if (actor.role !== "owner" && entry.workerId !== actor.workerId) return fail("You can only remove hours you logged yourself.");
    job.hours = (job.hours ?? []).filter((item) => item.id !== entryId);
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }) };
  });
}
