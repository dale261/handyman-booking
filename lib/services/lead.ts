import type { Repository } from "@/lib/db/repository";
import type { Actor, WorkerRecord } from "@/lib/db/types";

/** The crew a signed-in crew member leads, and who is on it. */
export type LeadCrew = { me: WorkerRecord; crewId: string; crewName: string; members: WorkerRecord[] };

/**
 * The crew this person leads, or null when they don't lead one. A lead is a crew member
 * the owner has marked as lead, on a crew, and still active. The crew is everyone active
 * on that same crew, the lead included. The owner is never a "lead": the owner can
 * already do all of it for everyone.
 *
 * Every lead-only screen and every lead-only change asks this on the server, so hiding a
 * button is never what keeps another crew's hours or pay private.
 */
export async function leadCrew(repo: Repository, actor: Actor): Promise<LeadCrew | null> {
  if (actor.role !== "worker" || !actor.workerId) return null;
  const workers = await repo.listWorkers();
  const me = workers.find((worker) => worker.id === actor.workerId);
  if (!me || !me.active || !me.lead || !me.crewId) return null;
  const crew = (await repo.listCrews()).find((item) => item.id === me.crewId);
  if (!crew || !crew.active) return null;
  const members = workers
    .filter((worker) => worker.active && worker.crewId === me.crewId)
    .sort((a, b) => Number(b.id === me.id) - Number(a.id === me.id) || a.fullName.localeCompare(b.fullName));
  return { me, crewId: crew.id, crewName: crew.name, members };
}

/** True when this person leads the crew that worker is on. Leading yourself counts. */
export async function leadsWorker(repo: Repository, actor: Actor, workerId: string): Promise<boolean> {
  const crew = await leadCrew(repo, actor);
  return Boolean(crew && crew.members.some((member) => member.id === workerId));
}

/** Said to a crew member who tries to act for someone they don't lead. */
export const NOT_YOUR_CREW = "You can only do that for yourself, or for people on the crew you lead.";
