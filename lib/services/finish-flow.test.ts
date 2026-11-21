import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { amountPayable, approveWork, completeWork, createQuote, holdSlot, payJob, resumeAfterProblem, reportProblem, startWork } from "@/lib/services/booking";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-finish-"));
  dirs.push(dir);
  return new LocalRepository(dir);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function actor(store: LocalRepository, id: string) {
  const user = await store.getUser(id);
  if (!user) throw new Error("missing demo user");
  return actorFromUser(user);
}

/** A paint job big enough to be half down, booked, paid its deposit, and started. */
async function startedHalfDownJob(store: LocalRepository) {
  const customer = await actor(store, DEMO_USERS.customer);
  const owner = await actor(store, DEMO_USERS.owner);
  const created = await createQuote(store, customer, {
    service: "paint",
    description: "Repaint one large great room with vaulted ceilings",
    // One big room keeps it a single-day job while the price lands well over the half-down amount.
    params: { ...DEFAULT_PARAMS, rooms: 1, roomLength: 40, roomWidth: 30, height: "11", cond: "poor", doors: 4, colors: 2 },
    differentSite: false,
    jobSiteAddress: "",
    urgent: false,
    pickup: false,
    preferredWorkerId: null,
    photos: [],
  });
  if (!created.ok) throw new Error(created.error);
  const held = await holdSlot(store, customer, created.data.id, "earliest");
  if (!held.ok) throw new Error(held.error);
  const paid = await payJob(store, customer, created.data.id, "paypal");
  if (!paid.ok) throw new Error(paid.error);
  const started = await startWork(store, owner, created.data.id);
  if (!started.ok) throw new Error(started.error);
  return { customer, owner, job: started.data };
}

describe("finishing a half-down job", () => {
  it("makes the balance due the moment the crew marks it finished", async () => {
    const store = repo();
    const { customer, owner, job } = await startedHalfDownJob(store);
    expect(job.balanceDue).toBeGreaterThan(0);
    // While the work is underway the balance can't be paid yet.
    expect(amountPayable(job)).toBe(0);

    const done = await completeWork(store, owner, job.id, "Two coats, cleaned up.");
    if (!done.ok) throw new Error(done.error);
    expect(done.data.status).toBe("balance_due");
    expect(amountPayable(done.data)).toBe(done.data.balanceDue);
    const notes = await store.listNotifications();
    expect(notes.some((note) => note.title.startsWith("Work complete:") && note.title.endsWith("balance now due"))).toBe(true);

    // The customer pays without ever approving anything.
    const paid = await payJob(store, customer, job.id, "paypal");
    if (!paid.ok) throw new Error(paid.error);
    expect(paid.data.status).toBe("completed");
    expect((paid.data.signOffs ?? []).length).toBe(0);
  });

  it("keeps confirming the work optional, before or after paying", async () => {
    const store = repo();
    const { customer, owner, job } = await startedHalfDownJob(store);
    await completeWork(store, owner, job.id, "");

    const confirmed = await approveWork(store, customer, job.id);
    if (!confirmed.ok) throw new Error(confirmed.error);
    // Confirming doesn't change what is owed or the job's place in line.
    expect(confirmed.data.status).toBe("balance_due");
    expect(confirmed.data.signOffs?.length).toBe(1);

    // Tapping again doesn't add a second record.
    const again = await approveWork(store, customer, job.id);
    if (!again.ok) throw new Error(again.error);
    expect(again.data.signOffs?.length).toBe(1);
  });

  it("lets the customer report a problem instead of paying, and puts the balance back when it's cleared", async () => {
    const store = repo();
    const { customer, owner, job } = await startedHalfDownJob(store);
    await completeWork(store, owner, job.id, "");

    const problem = await reportProblem(store, customer, job.id, "One wall needs a second look.");
    if (!problem.ok) throw new Error(problem.error);
    expect(problem.data.status).toBe("disputed");
    expect(amountPayable(problem.data)).toBe(0);

    const cleared = await resumeAfterProblem(store, owner, job.id);
    if (!cleared.ok) throw new Error(cleared.error);
    expect(cleared.data.status).toBe("balance_due");
  });

  it("does not let the work be confirmed before it's finished", async () => {
    const store = repo();
    const { customer, job } = await startedHalfDownJob(store);
    const early = await approveWork(store, customer, job.id);
    expect(early.ok).toBe(false);
  });
});
