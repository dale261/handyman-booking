import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { formatDate, todayDetroit } from "@/lib/format";
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

  it("lets a crew member log hours on a job another crew is on", async () => {
    const store = repo();
    const { job } = await booked(store);
    const fresh = await store.getJob(job.id);
    const outsider = (await store.listWorkers()).find((worker) => !fresh?.workerIds.includes(worker.id) && worker.crewId !== fresh?.crewId);
    if (!outsider) throw new Error("demo data needs a worker on another crew for this test");
    const crew = { id: "crew-login", role: "worker" as const, email: outsider.email, fullName: outsider.fullName, phone: "", workerId: outsider.id };

    const added = await addHours(store, crew, job.id, { date: today, hours: 2.5, note: "Helped carry" });
    if (!added.ok) throw new Error(added.error);
    expect(added.data.hours?.[0]).toMatchObject({ workerId: outsider.id, hours: 2.5 });
    // Helping out doesn't put them on the job.
    expect(added.data.workerIds).toEqual(fresh?.workerIds);
    expect(added.data.crewId).toBe(fresh?.crewId);
  });

  it("takes hours on a job the owner added, with no time held and no crew on it", async () => {
    const store = repo();
    const { job } = await quoted(store);
    const worker = await actor(store, DEMO_USERS.worker);
    // Written up by the owner, nothing scheduled yet.
    const typed = await store.saveJob({ ...job, ownerPriced: true }, { skipOverlap: true });
    expect(typed.status).toBe("quoted");
    expect(typed.workerIds).toHaveLength(0);
    expect((await addHours(store, worker, typed.id, { date: today, hours: 3, note: "" })).ok).toBe(true);

    // Finished work written up as an invoice: never scheduled, never has a crew.
    const second = await quoted(store);
    const invoice = await store.saveJob({ ...second.job, ownerPriced: true, status: "balance_due", workDoneOn: today }, { skipOverlap: true });
    const added = await addHours(store, worker, invoice.id, { date: today, hours: 4, note: "" });
    if (!added.ok) throw new Error(added.error);
    expect(added.data.hours?.[0].workerId).toBe(worker.workerId);
    expect(added.data.status).toBe("balance_due");
    expect(added.data.total).toBe(invoice.total);
  });

  it("takes hours on a website job once the customer has held a time, and never on a cancelled job", async () => {
    const store = repo();
    const { customer, job } = await quoted(store);
    const worker = await actor(store, DEMO_USERS.worker);
    // Only priced so far: there is no job to work yet.
    expect((await addHours(store, worker, job.id, { date: today, hours: 2, note: "" })).ok).toBe(false);
    const held = await holdSlot(store, customer, job.id, "earliest");
    if (!held.ok) throw new Error(held.error);
    expect(held.data.status).toBe("held");
    expect((await addHours(store, worker, job.id, { date: today, hours: 2, note: "" })).ok).toBe(true);

    const latest = await store.getJob(job.id);
    if (!latest) throw new Error("job missing");
    await store.saveJob({ ...latest, status: "cancelled" }, { skipOverlap: true });
    const refused = await addHours(store, worker, job.id, { date: today, hours: 1, note: "" });
    expect(refused.ok).toBe(false);
    // The owner's own job is no different once it is cancelled.
    const owner = await actor(store, DEMO_USERS.owner);
    const typed = await quoted(store);
    await store.saveJob({ ...typed.job, ownerPriced: true, status: "cancelled" }, { skipOverlap: true });
    expect((await addHours(store, owner, typed.job.id, { workerId: worker.workerId ?? "", date: today, hours: 1, note: "" })).ok).toBe(false);
  });

  it("emails the owner each time a crew member logs or removes hours, with their week so far", async () => {
    const store = repo();
    const { job } = await booked(store);
    const worker = await actor(store, DEMO_USERS.worker);
    const owner = await actor(store, DEMO_USERS.owner);
    const aboutHours = async () => (await store.listEmails()).filter((email) => email.to === owner.email && / (logged|removed) /.test(email.subject));
    const queueBefore = (await store.listNotifications()).length;
    expect(await aboutHours()).toHaveLength(0);

    const first = await addHours(store, worker, job.id, { date: today, hours: 3.5, note: "Hung the mount" });
    if (!first.ok) throw new Error(first.error);
    let emails = await aboutHours();
    expect(emails).toHaveLength(1);
    expect(emails[0].subject).toBe(`${worker.fullName} logged 3.5 hrs for ${formatDate(today)}: ${job.scope}`);
    expect(emails[0].body).toContain(`${worker.fullName} logged 3.5 hrs on ${job.scope} for ${formatDate(today)}.`);
    expect(emails[0].body).toContain("Note: Hung the mount");
    expect(emails[0].body).toContain("is now 3.5 hrs, shop time included.");
    expect(emails[0].body).toContain("/owner/hours?week=");
    expect(emails[0].jobId).toBe(job.id);
    // The customer's name, phone and the price stay out of it.
    expect(emails[0].body).not.toContain("$");

    const second = await addHours(store, worker, job.id, { date: today, hours: 2, note: "" });
    if (!second.ok) throw new Error(second.error);
    emails = await aboutHours();
    expect(emails).toHaveLength(2);
    const later = emails.find((email) => email.subject.includes("logged 2 hrs"));
    expect(later?.body).toContain("is now 5.5 hrs");
    expect(later?.body).not.toContain("Note:");

    const entryId = first.data.hours?.find((entry) => entry.hours === 3.5)?.id ?? "";
    expect((await removeHours(store, worker, job.id, entryId)).ok).toBe(true);
    emails = await aboutHours();
    expect(emails).toHaveLength(3);
    const taken = emails.find((email) => email.subject.includes(" removed "));
    expect(taken?.subject).toBe(`${worker.fullName} removed 3.5 hrs for ${formatDate(today)}: ${job.scope}`);
    expect(taken?.body).toContain("is now 2 hrs");

    // Nothing for the owner to act on, so nothing lands in the Queue.
    expect((await store.listNotifications()).length).toBe(queueBefore);
  });

  it("sends nothing when the owner enters or removes the hours", async () => {
    const store = repo();
    const { job } = await booked(store);
    const worker = await actor(store, DEMO_USERS.worker);
    const owner = await actor(store, DEMO_USERS.owner);
    const before = (await store.listEmails()).length;
    const added = await addHours(store, owner, job.id, { workerId: worker.workerId ?? "", date: today, hours: 4, note: "" });
    if (!added.ok) throw new Error(added.error);
    expect((await removeHours(store, owner, job.id, added.data.hours?.[0].id ?? "")).ok).toBe(true);
    expect((await store.listEmails()).length).toBe(before);
  });

  it("still saves the hours when the email can't be put together", async () => {
    const store = repo();
    const { job } = await booked(store);
    const worker = await actor(store, DEMO_USERS.worker);
    const realError = console.error;
    console.error = () => {};
    try {
      store.getSettings = async () => {
        throw new Error("settings are down");
      };
      const added = await addHours(store, worker, job.id, { date: today, hours: 1.5, note: "" });
      if (!added.ok) throw new Error(added.error);
      expect(added.data.hours).toHaveLength(1);
      expect((await store.getJob(job.id))?.hours?.[0].hours).toBe(1.5);
    } finally {
      console.error = realError;
    }
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
