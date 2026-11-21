import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { addDays } from "@/lib/domain/hours";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { todayDetroit } from "@/lib/format";
import { createQuote } from "@/lib/services/booking";
import { addExpense, addShopHours, removeCrewEntry, setReimbursed } from "@/lib/services/crew-log";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-crewlog-"));
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

const today = todayDetroit();
const PHOTO = "11111111-2222-4333-8444-555555555555";

describe("shop time", () => {
  it("lets a crew member log their own, under their own name", async () => {
    const store = repo();
    const worker = await actor(store, DEMO_USERS.worker);
    const other = (await store.listWorkers()).find((item) => item.id !== worker.workerId);
    // Naming someone else is ignored: a crew member only ever logs for themselves.
    const added = await addShopHours(store, worker, { workerId: other?.id, date: today, hours: 1.5, note: " Loaded the truck " });
    if (!added.ok) throw new Error(added.error);
    expect(added.data.workerId).toBe(worker.workerId);
    expect(added.data.note).toBe("Loaded the truck");
    expect(await store.listCrewEntries()).toHaveLength(1);
  });

  it("makes the owner say who it was, and refuses a customer", async () => {
    const store = repo();
    const owner = await actor(store, DEMO_USERS.owner);
    const customer = await actor(store, DEMO_USERS.customer);
    expect((await addShopHours(store, owner, { date: today, hours: 2, note: "" })).ok).toBe(false);
    expect((await addShopHours(store, customer, { date: today, hours: 2, note: "" })).ok).toBe(false);
    const worker = (await store.listWorkers())[0];
    const added = await addShopHours(store, owner, { workerId: worker.id, date: today, hours: 2, note: "" });
    if (!added.ok) throw new Error(added.error);
    expect(added.data.workerName).toBe(worker.fullName);
  });

  it("refuses odd amounts, future days, and more than a day's worth", async () => {
    const store = repo();
    const worker = await actor(store, DEMO_USERS.worker);
    expect((await addShopHours(store, worker, { date: today, hours: 1.1, note: "" })).ok).toBe(false);
    expect((await addShopHours(store, worker, { date: addDays(today, 1), hours: 1, note: "" })).ok).toBe(false);
    expect((await addShopHours(store, worker, { date: today, hours: 16, note: "" })).ok).toBe(true);
    expect((await addShopHours(store, worker, { date: today, hours: 8.25, note: "" })).ok).toBe(false);
    expect(await store.listCrewEntries()).toHaveLength(1);
  });

  it("can be taken back by the person who added it, not by someone else on the crew", async () => {
    const store = repo();
    const worker = await actor(store, DEMO_USERS.worker);
    const owner = await actor(store, DEMO_USERS.owner);
    const other = (await store.listWorkers()).find((item) => item.id !== worker.workerId);
    if (!other) throw new Error("need a second crew member");
    const theirs = await addShopHours(store, owner, { workerId: other.id, date: today, hours: 1, note: "" });
    const mine = await addShopHours(store, worker, { date: today, hours: 1, note: "" });
    if (!theirs.ok || !mine.ok) throw new Error("setup failed");
    expect((await removeCrewEntry(store, worker, theirs.data.id)).ok).toBe(false);
    expect((await removeCrewEntry(store, worker, mine.data.id)).ok).toBe(true);
    expect((await removeCrewEntry(store, worker, mine.data.id)).ok).toBe(false);
    expect((await store.listCrewEntries()).map((entry) => entry.id)).toEqual([theirs.data.id]);
  });
});

describe("receipts", () => {
  it("saves a crew member's receipt as owed and tells the owner", async () => {
    const store = repo();
    const worker = await actor(store, DEMO_USERS.worker);
    const before = (await store.listNotifications()).length;
    const added = await addExpense(store, worker, { date: today, amount: 24.5, what: "Caulk and painter's tape", photoId: PHOTO });
    if (!added.ok) throw new Error(added.error);
    expect(added.data).toMatchObject({ kind: "expense", workerId: worker.workerId, amount: 24.5, jobId: null, photoId: PHOTO, reimbursedAt: null });
    const notes = await store.listNotifications();
    expect(notes.length).toBe(before + 1);
    expect(notes.some((note) => note.title.includes("$24.50"))).toBe(true);
  });

  it("drops a photo id that isn't one, and refuses a bad amount", async () => {
    const store = repo();
    const worker = await actor(store, DEMO_USERS.worker);
    const added = await addExpense(store, worker, { date: today, amount: 12, what: "Gas", photoId: "../../etc/passwd" });
    if (!added.ok) throw new Error(added.error);
    expect(added.data.photoId).toBe(null);
    expect((await addExpense(store, worker, { date: today, amount: 0, what: "Gas" })).ok).toBe(false);
    expect((await addExpense(store, worker, { date: today, amount: 12, what: "" })).ok).toBe(false);
  });

  it("only ties a receipt to a job that person can see", async () => {
    const store = repo();
    const worker = await actor(store, DEMO_USERS.worker);
    const owner = await actor(store, DEMO_USERS.owner);
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
    // A quote nobody is assigned to isn't on the crew member's list.
    expect((await addExpense(store, worker, { date: today, amount: 9, what: "Anchors", jobId: created.data.id })).ok).toBe(false);
    const forWorker = (await store.listWorkers())[0];
    const added = await addExpense(store, owner, { workerId: forWorker.id, date: today, amount: 9, what: "Anchors", jobId: created.data.id });
    if (!added.ok) throw new Error(added.error);
    expect(added.data.jobId).toBe(created.data.id);
    expect(added.data.jobScope.length).toBeGreaterThan(0);
  });

  it("lets only the owner mark it paid back, and then it stays on the record", async () => {
    const store = repo();
    const worker = await actor(store, DEMO_USERS.worker);
    const owner = await actor(store, DEMO_USERS.owner);
    const added = await addExpense(store, worker, { date: today, amount: 40, what: "Drain cable" });
    if (!added.ok) throw new Error(added.error);
    expect((await setReimbursed(store, worker, added.data.id, true)).ok).toBe(false);
    const paid = await setReimbursed(store, owner, added.data.id, true);
    if (!paid.ok) throw new Error(paid.error);
    expect(typeof paid.data.reimbursedAt).toBe("string");
    // Once it's paid back the crew member can't remove it.
    expect((await removeCrewEntry(store, worker, added.data.id)).ok).toBe(false);
    const undone = await setReimbursed(store, owner, added.data.id, false);
    if (!undone.ok) throw new Error(undone.error);
    expect(undone.data.reimbursedAt).toBe(null);
    expect((await removeCrewEntry(store, worker, added.data.id)).ok).toBe(true);
    expect(await store.listCrewEntries()).toHaveLength(0);
  });

  it("keeps working on a saved file from before the crew log existed", async () => {
    const store = repo();
    const worker = await actor(store, DEMO_USERS.worker);
    expect(await store.listCrewEntries()).toEqual([]);
    expect(await store.getCrewEntry("nope")).toBe(null);
    expect(await store.crewLogReady()).toBe(true);
    expect((await addShopHours(store, worker, { date: today, hours: 1, note: "" })).ok).toBe(true);
  });
});
