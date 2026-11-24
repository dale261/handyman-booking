import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser, type ShopHoursEntry } from "@/lib/db/types";
import { balances, loggedHours, needsRate } from "@/lib/domain/pay";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { todayDetroit } from "@/lib/format";
import { createQuote } from "@/lib/services/booking";
import { addShopHours, removeCrewEntry } from "@/lib/services/crew-log";
import { addHours, removeHours } from "@/lib/services/hours";
import { addFlatPay, addPayment, addPayPerson, removePayItem, setRate } from "@/lib/services/pay";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-pay-"));
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

/** A job the owner added, which takes hours straight away, with the three sign-ins. */
async function setup() {
  const store = repo();
  const customer = await actor(store, DEMO_USERS.customer);
  const worker = await actor(store, DEMO_USERS.worker);
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
  const job = await store.saveJob({ ...created.data, ownerPriced: true }, { skipOverlap: true });
  return { store, customer, worker, owner, job };
}

async function waiting(store: LocalRepository) {
  const shop = (await store.listCrewEntries()).filter((entry): entry is ShopHoursEntry => entry.kind === "shop_hours");
  return needsRate(loggedHours(await store.listJobs(), shop), await store.listPay());
}

describe("setting a rate on logged hours", () => {
  it("is the owner's to do: the crew logs the hours, the owner sets the rate, the pay is hours times rate", async () => {
    const { store, customer, worker, owner, job } = await setup();
    const logged = await addHours(store, worker, job.id, { date: today, hours: 3.5, note: "Hung the mount" });
    if (!logged.ok) throw new Error(logged.error);
    const entryId = logged.data.hours?.[0].id ?? "";
    expect((await waiting(store)).map((entry) => entry.entryId)).toEqual([entryId]);

    expect((await setRate(store, worker, entryId, 20)).ok).toBe(false);
    expect((await setRate(store, customer, entryId, 20)).ok).toBe(false);
    expect(await store.listPay()).toHaveLength(0);

    const set = await setRate(store, owner, entryId, 20);
    if (!set.ok) throw new Error(set.error);
    expect(set.data).toMatchObject({ kind: "pay", workerId: worker.workerId, date: today, hours: 3.5, rate: 20, amount: 70, entryId, jobId: job.id, what: job.scope, note: "Hung the mount" });
    expect(await waiting(store)).toHaveLength(0);
  });

  it("changes the same line when the rate is set again, and takes zero for hours that aren't paid", async () => {
    const { store, worker, owner, job } = await setup();
    const logged = await addHours(store, worker, job.id, { date: today, hours: 4, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    const entryId = logged.data.hours?.[0].id ?? "";
    const first = await setRate(store, owner, entryId, 10);
    const second = await setRate(store, owner, entryId, 37.5);
    if (!first.ok || !second.ok) throw new Error("rate not set");
    expect(second.data.id).toBe(first.data.id);
    expect(second.data.amount).toBe(150);
    expect(await store.listPay()).toHaveLength(1);
    const zero = await setRate(store, owner, entryId, 0);
    if (!zero.ok) throw new Error(zero.error);
    expect(zero.data.amount).toBe(0);
    expect(await waiting(store)).toHaveLength(0);
  });

  it("works on shop time, and refuses a bad rate or hours that are gone", async () => {
    const { store, worker, owner } = await setup();
    const shop = await addShopHours(store, worker, { date: today, hours: 1.5, note: "Scraped a sign" });
    if (!shop.ok) throw new Error(shop.error);
    expect((await setRate(store, owner, shop.data.id, -5)).ok).toBe(false);
    expect((await setRate(store, owner, shop.data.id, Number.NaN)).ok).toBe(false);
    expect((await setRate(store, owner, "no-such-entry", 15)).ok).toBe(false);
    const set = await setRate(store, owner, shop.data.id, 15);
    if (!set.ok) throw new Error(set.error);
    expect(set.data).toMatchObject({ hours: 1.5, rate: 15, amount: 22.5, jobId: null, what: "Shop time" });
  });

  it("keeps rates and pay off the job record and out of the crew log, where customers and crew could read them", async () => {
    const { store, worker, owner, job } = await setup();
    const logged = await addHours(store, worker, job.id, { date: today, hours: 2, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    const shop = await addShopHours(store, worker, { date: today, hours: 1, note: "" });
    if (!shop.ok) throw new Error(shop.error);
    await setRate(store, owner, logged.data.hours?.[0].id ?? "", 41.25);
    await setRate(store, owner, shop.data.id, 41.25);
    await addPayment(store, owner, { workerId: worker.workerId ?? "", date: today, amount: 77.77, note: "" });
    const onJob = JSON.stringify(await store.getJob(job.id));
    expect(onJob).not.toContain("41.25");
    expect(onJob).not.toContain("82.5");
    const crewLog = JSON.stringify(await store.listCrewEntries());
    expect(crewLog).not.toContain("41.25");
    expect(crewLog).not.toContain("77.77");
    expect((await store.listCrewEntries()).map((entry) => entry.kind)).toEqual(["shop_hours"]);
  });
});

describe("flat pay and payments", () => {
  it("add up to what each person is owed", async () => {
    const { store, worker, owner, job } = await setup();
    const workerId = worker.workerId ?? "";
    const logged = await addHours(store, worker, job.id, { date: today, hours: 8, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    await setRate(store, owner, logged.data.hours?.[0].id ?? "", 15);
    const flat = await addFlatPay(store, owner, { workerId, date: today, amount: 150, what: "Flat rate, split two ways", jobId: job.id });
    if (!flat.ok) throw new Error(flat.error);
    expect(flat.data).toMatchObject({ hours: null, rate: null, amount: 150, entryId: null, jobId: job.id, what: "Flat rate, split two ways" });
    const paid = await addPayment(store, owner, { workerId, date: today, amount: 200, note: "Cash" });
    if (!paid.ok) throw new Error(paid.error);
    expect(paid.data).toMatchObject({ kind: "payment", amount: 200, note: "Cash" });

    const [mine] = balances(await store.listPay());
    expect(mine).toMatchObject({ workerId, earned: 270, paid: 200, owed: 70, lastPaid: today });

    expect((await removePayItem(store, owner, paid.data.id)).ok).toBe(true);
    expect(balances(await store.listPay())[0].owed).toBe(270);
    // Flat pay isn't hours, so it never shows as hours needing a rate.
    expect(await waiting(store)).toHaveLength(0);
  });

  it("are the owner's only, and refuse a missing person, a bad amount, a day that hasn't come, or a job that isn't in the app", async () => {
    const { store, worker, owner } = await setup();
    const workerId = worker.workerId ?? "";
    expect((await addPayment(store, worker, { workerId, date: today, amount: 50, note: "" })).ok).toBe(false);
    expect((await addFlatPay(store, worker, { workerId, date: today, amount: 50, what: "Bonus" })).ok).toBe(false);
    expect((await addPayment(store, owner, { workerId: "nobody", date: today, amount: 50, note: "" })).ok).toBe(false);
    expect((await addPayment(store, owner, { workerId, date: today, amount: 0, note: "" })).ok).toBe(false);
    expect((await addPayment(store, owner, { workerId, date: "2999-01-01", amount: 50, note: "" })).ok).toBe(false);
    expect((await addFlatPay(store, owner, { workerId, date: today, amount: 50, what: "" })).ok).toBe(false);
    expect((await addFlatPay(store, owner, { workerId, date: today, amount: 50, what: "Bonus", jobId: "no-such-job" })).ok).toBe(false);
    expect(await store.listPay()).toHaveLength(0);
    const made = await addPayment(store, owner, { workerId, date: today, amount: 50, note: "" });
    if (!made.ok) throw new Error(made.error);
    expect((await removePayItem(store, worker, made.data.id)).ok).toBe(false);
    expect(await store.listPay()).toHaveLength(1);
  });
});

describe("removing hours that have pay on them", () => {
  it("is refused for the crew member, on a job and on shop time", async () => {
    const { store, worker, owner, job } = await setup();
    const logged = await addHours(store, worker, job.id, { date: today, hours: 2, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    const entryId = logged.data.hours?.[0].id ?? "";
    const shop = await addShopHours(store, worker, { date: today, hours: 1, note: "" });
    if (!shop.ok) throw new Error(shop.error);
    await setRate(store, owner, entryId, 20);
    await setRate(store, owner, shop.data.id, 15);

    expect((await removeHours(store, worker, job.id, entryId)).ok).toBe(false);
    expect((await removeCrewEntry(store, worker, shop.data.id)).ok).toBe(false);
    expect((await store.getJob(job.id))?.hours).toHaveLength(1);
    expect(await store.listCrewEntries()).toHaveLength(1);
    expect(await store.listPay()).toHaveLength(2);
  });

  it("is still fine for the crew member before a rate is set", async () => {
    const { store, worker, job } = await setup();
    const logged = await addHours(store, worker, job.id, { date: today, hours: 2, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    expect((await removeHours(store, worker, job.id, logged.data.hours?.[0].id ?? "")).ok).toBe(true);
  });

  it("takes the pay line off too when the owner removes them, so nobody is owed for hours that aren't there", async () => {
    const { store, worker, owner, job } = await setup();
    const logged = await addHours(store, worker, job.id, { date: today, hours: 2, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    const entryId = logged.data.hours?.[0].id ?? "";
    const shop = await addShopHours(store, worker, { date: today, hours: 1, note: "" });
    if (!shop.ok) throw new Error(shop.error);
    await setRate(store, owner, entryId, 20);
    await setRate(store, owner, shop.data.id, 15);
    await addPayment(store, owner, { workerId: worker.workerId ?? "", date: today, amount: 10, note: "" });

    expect((await removeHours(store, owner, job.id, entryId)).ok).toBe(true);
    expect((await removeCrewEntry(store, owner, shop.data.id)).ok).toBe(true);
    const left = await store.listPay();
    expect(left.map((item) => item.kind)).toEqual(["payment"]);
  });
});

describe("someone to pay who isn't on the crew list", () => {
  it("is added by name only, with no sign-in and no place on the schedule, and can then be paid", async () => {
    const { store, worker, owner } = await setup();
    expect((await addPayPerson(store, worker, "Helper Hank")).ok).toBe(false);
    expect((await addPayPerson(store, owner, " ")).ok).toBe(false);
    const added = await addPayPerson(store, owner, "  Helper   Hank ");
    if (!added.ok) throw new Error(added.error);
    expect(added.data).toMatchObject({ fullName: "Helper Hank", active: false, crewId: null, profileId: null, email: "" });
    expect((await addPayPerson(store, owner, "helper hank")).ok).toBe(false);

    const flat = await addFlatPay(store, owner, { workerId: added.data.id, date: today, amount: 200, what: "Flat rate for siding" });
    const paid = await addPayment(store, owner, { workerId: added.data.id, date: today, amount: 200, note: "" });
    expect(flat.ok && paid.ok).toBe(true);
    expect(balances(await store.listPay())[0]).toMatchObject({ workerName: "Helper Hank", earned: 200, paid: 200, owed: 0 });
  });
});

describe("the hours email", () => {
  it("points the owner at the Pay page to set the rate", async () => {
    const { store, worker, owner, job } = await setup();
    const logged = await addHours(store, worker, job.id, { date: today, hours: 2, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    const email = (await store.listEmails()).find((item) => item.to === owner.email && item.subject.includes(" logged "));
    expect(email?.body).toContain("Set the rate for these hours: ");
    expect(email?.body).toContain("/owner/pay");
    // The email itself never carries a rate or pay.
    expect(email?.body).not.toContain("$");
  });
});
