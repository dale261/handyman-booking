import { createHash, randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, ShopHoursEntry, WorkerRecord } from "@/lib/db/types";
import { loggedHours } from "@/lib/domain/pay";
import { LOAD_LIMITS, planLoad, readPayFile, type LoadChoices, type LoadPlan, type LoadSummary } from "@/lib/domain/pay-load";
import { todayDetroit } from "@/lib/format";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

const OWNER_ONLY = "Only the owner can load pay records.";
const NOT_READY = "Crew pay needs one setup step first: run the crew_pay SQL file in Supabase.";

/**
 * The id a line of the file is saved under. It comes from the line's own contents, so
 * loading the same file twice saves each line once.
 */
export function loadId(key: string): string {
  const hex = createHash("sha256").update(`crew-pay-load|${key}`).digest("hex");
  const variant = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function plan(repo: Repository, text: string, choices: LoadChoices): Promise<{ plan: LoadPlan; workers: WorkerRecord[] }> {
  const workers = await repo.listWorkers();
  const jobs = await repo.listJobs();
  const shop = (await repo.listCrewEntries()).filter((entry): entry is ShopHoursEntry => entry.kind === "shop_hours");
  const pay = await repo.listPay();
  const file = readPayFile(text.slice(0, LOAD_LIMITS.chars), todayDetroit());
  return { plan: planLoad({ file, workers, jobs, logged: loggedHours(jobs, shop), pay, choices, makeId: loadId, now: new Date() }), workers };
}

/** Read the file and say what loading it would do. Saves nothing. */
export async function checkPayFile(repo: Repository, actor: Actor, text: string, choices: LoadChoices): Promise<Ok<LoadSummary> | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  if (!text.trim()) return fail("Choose the file, or paste what's in it, first.");
  if (text.length > LOAD_LIMITS.chars) return fail("That's too much to read in one go. Split the file up.");
  if (!(await repo.payReady())) return fail(NOT_READY);
  const { plan: made, workers } = await plan(repo, text, choices);
  const crew = workers
    .map((worker) => ({ id: worker.id, fullName: worker.fullName, active: worker.active }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName));
  // The lines themselves stay on the server. The screen gets the counts and the totals.
  const summary: LoadSummary = { read: made.read, problems: made.problems, warnings: made.warnings, people: made.people, jobs: made.jobs, counts: made.counts, after: made.after, newPeople: made.newPeople, crew };
  return { ok: true, data: summary };
}

export type LoadResult = { added: number; linked: number; skipped: number; removed: number; people: string[] };

/**
 * Load the file: add the people who aren't on the crew list, save the lines, and take
 * off whatever an earlier load put in that this file doesn't have. Nothing is loaded if
 * any line of the file can't be read.
 */
export async function loadPayFile(repo: Repository, actor: Actor, text: string, choices: LoadChoices): Promise<Ok<LoadResult> | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  if (!text.trim()) return fail("Choose the file, or paste what's in it, first.");
  if (text.length > LOAD_LIMITS.chars) return fail("That's too much to read in one go. Split the file up.");
  if (!(await repo.payReady())) return fail(NOT_READY);
  const { plan: made, workers } = await plan(repo, text, choices);
  if (made.problems.length > 0) return fail(`${made.problems.length === 1 ? "One line of the file can't" : `${made.problems.length} lines of the file can't`} be read, so nothing was loaded. Fix the file and check it again.`);
  try {
    // People who aren't on the crew list go on it by name only: no sign-in, no place on the schedule.
    const added: string[] = [];
    const ids = new Map<string, string>();
    for (const name of made.newPeople) {
      const already = workers.find((worker) => worker.fullName.trim().toLowerCase() === name.trim().toLowerCase());
      if (already) {
        ids.set(name, already.id);
        continue;
      }
      const worker: WorkerRecord = { id: randomUUID(), profileId: null, fullName: name.slice(0, 80), email: "", crewId: null, dayStartMin: 480, dayEndMin: 1020, workDays: [], active: false };
      await repo.saveWorker(worker);
      ids.set(name, worker.id);
      added.push(worker.fullName);
    }
    const items = made.items.map((item) => (item.workerId.startsWith("new:") ? { ...item, workerId: ids.get(item.workerId.slice(4)) ?? item.workerId } : item));
    if (items.some((item) => item.workerId.startsWith("new:"))) return fail("Couldn't add everyone in the file to the crew list. Nothing was loaded.");
    await repo.savePayItems(items);
    await repo.deletePayItems(made.stale);
    return { ok: true, data: { added: items.length, linked: made.counts.linked, skipped: made.counts.skipped, removed: made.stale.length, people: added } };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "The load didn't finish. Check the file again and retry: loading twice is safe.");
  }
}

/** Take off everything that was loaded from a file. Rates set and payments recorded on the site stay. */
export async function clearLoadedPay(repo: Repository, actor: Actor): Promise<Ok<number> | Err> {
  if (actor.role !== "owner") return fail(OWNER_ONLY);
  try {
    const ids = (await repo.listPay()).filter((item) => item.loaded).map((item) => item.id);
    await repo.deletePayItems(ids);
    return { ok: true, data: ids.length };
  } catch (error) {
    return fail(error instanceof Error ? error.message : "That didn't finish. Try again.");
  }
}
