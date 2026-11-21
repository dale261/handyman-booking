import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { amountPayable, completeWork, createQuote, holdSlot, payJob, recordSignOff, startWork } from "@/lib/services/booking";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-signoff-"));
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

/** A booked and paid TV mount. */
async function bookedJob(store: LocalRepository) {
  const customer = await actor(store, DEMO_USERS.customer);
  const owner = await actor(store, DEMO_USERS.owner);
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
  const held = await holdSlot(store, customer, created.data.id, "earliest");
  if (!held.ok) throw new Error(held.error);
  const paid = await payJob(store, customer, created.data.id, "paypal");
  if (!paid.ok) throw new Error(paid.error);
  return { customer, owner, job: paid.data };
}

const manager = { name: "  Jordan   Reyes ", title: "Store manager", note: "Sink is solid now." };

describe("on-site sign-off", () => {
  it("is refused before the work has started", async () => {
    const store = repo();
    const { owner, job } = await bookedJob(store);
    const early = await recordSignOff(store, owner, job.id, manager);
    expect(early.ok).toBe(false);
  });

  it("records who signed, tidied up, once the work is underway", async () => {
    const store = repo();
    const { owner, job } = await bookedJob(store);
    await startWork(store, owner, job.id);
    const signed = await recordSignOff(store, owner, job.id, manager);
    if (!signed.ok) throw new Error(signed.error);
    const entry = signed.data.signOffs?.[0];
    expect(entry?.name).toBe("Jordan Reyes");
    expect(entry?.title).toBe("Store manager");
    expect(entry?.via).toBe("crew_phone");
    expect(entry?.note).toBe("Sink is solid now.");
    // A sign-off is a record. It doesn't finish the job or change what is owed.
    expect(signed.data.status).toBe("in_progress");
  });

  it("can be taken after the job is finished, and never changes what is owed", async () => {
    const store = repo();
    const { owner, job } = await bookedJob(store);
    await startWork(store, owner, job.id);
    const done = await completeWork(store, owner, job.id, "Mounted and level.");
    if (!done.ok) throw new Error(done.error);
    const before = amountPayable(done.data);
    const signed = await recordSignOff(store, owner, job.id, manager);
    if (!signed.ok) throw new Error(signed.error);
    expect(signed.data.status).toBe(done.data.status);
    expect(amountPayable(signed.data)).toBe(before);
  });

  it("tells the owner, and tells the customer when someone else signed", async () => {
    const store = repo();
    const { owner, job } = await bookedJob(store);
    await startWork(store, owner, job.id);
    await recordSignOff(store, owner, job.id, manager);
    const notes = await store.listNotifications();
    expect(notes.some((note) => note.title.startsWith("Signed off on site"))).toBe(true);
    const emails = await store.listEmails();
    const sent = emails.find((email) => email.subject.includes("work signed off on site"));
    expect(sent?.to).toBe(job.customerEmail);
    expect(sent?.body).toContain("Jordan Reyes, Store manager signed off on site");
  });

  it("doesn't email the customer about their own sign-off", async () => {
    const store = repo();
    const { owner, job } = await bookedJob(store);
    await startWork(store, owner, job.id);
    await recordSignOff(store, owner, job.id, { name: job.customerName, title: "", note: "" });
    const emails = await store.listEmails();
    expect(emails.some((email) => email.subject.includes("work signed off on site"))).toBe(false);
  });

  it("needs a name, and only the crew or the owner can take one", async () => {
    const store = repo();
    const { customer, owner, job } = await bookedJob(store);
    await startWork(store, owner, job.id);
    const blank = await recordSignOff(store, owner, job.id, { name: " ", title: "", note: "" });
    expect(blank.ok).toBe(false);
    const byCustomer = await recordSignOff(store, customer, job.id, manager);
    expect(byCustomer.ok).toBe(false);
    const still = await store.getJob(job.id);
    expect((still?.signOffs ?? []).length).toBe(0);
  });
});
