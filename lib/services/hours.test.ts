import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { todayDetroit } from "@/lib/format";
import { amountPayable, createQuote, holdSlot, payJob } from "@/lib/services/booking";
import { addHours, removeHours } from "@/lib/services/hours";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-hours-"));
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

async function quoted(store: LocalRepository) {
  const customer = await actor(store, DEMO_USERS.customer);
  const created = await createQuote(store, customer, {
    service: "tv",
    description: "Mount a 55-inch TV on a drywall wall",
    params: { ...DEFAULT_PARAMS, tvSize: "55", wall: "drywall", conceal: "none" },
    differentSite: false,
    jobSiteAddress: "",
    urgent: false,
    pickup: false,
    preferredWorkerId: null,
    photos: [],
  });
  if (!created.ok) throw new Error(created.error);
  return { customer, job: created.data };
}

/** A booked and paid TV mount, with a crew assigned. */
async function booked(store: LocalRepository) {
  const { customer, job } = await quoted(store);
  const held = await holdSlot(store, customer, job.id, "earliest");
  if (!held.ok) throw new Error(held.error);
  const paid = await payJob(store, customer, job.id, "paypal");
  if (!paid.ok) throw new Error(paid.error);
  const owner = await actor(store, DEMO_USERS.owner);
  return { customer, owner, job: paid.data };
}

const today = todayDetroit();

describe("logging hours on a job", () => {
  it("lets the owner log hours for a crew member, without touching the job's money or status", async () => {
    const store = repo();
    const { owner, job } = await booked(store);
    const worker = (await store.listWorkers())[0];
    const added = await addHours(store, owner, job.id, { workerId: worker.id, date: today, hours: 3.5, note: "Mounted and tidied cords" });
    if (!added.ok) throw new Error(added.error);
    expect(added.data.hours?.length).toBe(1);
    expect(added.data.hours?.[0].workerName).toBe(worker.fullName);
    expect(added.data.hours?.[0].hours).toBe(3.5);
    expect(added.data.status).toBe(job.status);
    expect(added.data.total).toBe(job.total);
    expect(amountPayable(added.data)).toBe(amountPayable(job));
  });

  it("makes the owner say who worked", async () => {
    const store = repo();
    const { owner, job } = await booked(store);
    const nobody = await addHours(store, owner, job.id, { date: today, hours: 2, note: "" });
    expect(nobody.ok).toBe(false);
    const stranger = await addHours(store, owner, job.id, { workerId: "not-a-worker", date: today, hours: 2, note: "" });
    expect(stranger.ok).toBe(false);
  });

  it("lets a crew member on the job log their own hours, and only their own", async () => {
    const store = repo();
    const { job } = await booked(store);
    const fresh = await store.getJob(job.id);
    const workers = await store.listWorkers();
    const onJob = workers.find((worker) => fresh?.workerIds.includes(worker.id));
    if (!onJob) throw new Error("the booked job has no crew member assigned");
    // Sign that crew member in, whoever the demo data assigned.
    const crew = { id: onJob.profileId ?? "crew-login", role: "worker" as const, email: onJob.email, fullName: onJob.fullName, phone: "", workerId: onJob.id };
    const other = workers.find((worker) => worker.id !== onJob.id);

    const added = await addHours(store, crew, job.id, { workerId: other?.id, date: today, hours: 4, note: "" });
    if (!added.ok) throw new Error(added.error);
    // Whatever worker id the form carried, a crew member's hours go under their own name.
    expect(added.data.hours?.[0].workerId).toBe(onJob.id);
  });

  it("refuses customers, jobs that aren't booked yet, and bad entries", async () => {
    const store = repo();
    const { customer, owner, job } = await booked(store);
    const worker = (await store.listWorkers())[0];
    expect((await addHours(store, customer, job.id, { workerId: worker.id, date: today, hours: 2, note: "" })).ok).toBe(false);
    expect((await addHours(store, owner, job.id, { workerId: worker.id, date: today, hours: 0, note: "" })).ok).toBe(false);
    expect((await addHours(store, owner, job.id, { workerId: worker.id, date: "2030-01-01", hours: 2, note: "" })).ok).toBe(false);

    const second = repo();
    const fresh = await quoted(second);
    const secondOwner = await actor(second, DEMO_USERS.owner);
    const secondWorker = (await second.listWorkers())[0];
    expect((await addHours(second, secondOwner, fresh.job.id, { workerId: secondWorker.id, date: today, hours: 2, note: "" })).ok).toBe(false);
  });

  it("won't put more than a day's worth of hours on one day", async () => {
    const store = repo();
    const { owner, job } = await booked(store);
    const worker = (await store.listWorkers())[0];
    expect((await addHours(store, owner, job.id, { workerId: worker.id, date: today, hours: 16, note: "" })).ok).toBe(true);
    expect((await addHours(store, owner, job.id, { workerId: worker.id, date: today, hours: 9, note: "" })).ok).toBe(false);
  });

  it("lets the owner remove any entry, and a crew member only their own", async () => {
    const store = repo();
    const { owner, job } = await booked(store);
    const workers = await store.listWorkers();
    const [first, second] = workers;
    if (!second) throw new Error("demo data needs two workers for this test");
    const a = await addHours(store, owner, job.id, { workerId: first.id, date: today, hours: 2, note: "" });
    const b = await addHours(store, owner, job.id, { workerId: second.id, date: today, hours: 3, note: "" });
    if (!a.ok || !b.ok) throw new Error("setup failed");
    const firstEntry = b.data.hours?.find((entry) => entry.workerId === first.id);
    const secondEntry = b.data.hours?.find((entry) => entry.workerId === second.id);
    if (!firstEntry || !secondEntry) throw new Error("entries missing");

    const crew = { id: "crew-login", role: "worker" as const, email: first.email, fullName: first.fullName, phone: "", workerId: first.id };
    expect((await removeHours(store, crew, job.id, secondEntry.id)).ok).toBe(false);
    expect((await removeHours(store, crew, job.id, firstEntry.id)).ok).toBe(true);
    const afterOwner = await removeHours(store, owner, job.id, secondEntry.id);
    if (!afterOwner.ok) throw new Error(afterOwner.error);
    expect((afterOwner.data.hours ?? []).length).toBe(0);
  });
});
