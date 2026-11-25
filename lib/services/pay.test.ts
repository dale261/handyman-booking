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
import { addFlatPay, addPayment, addPayPerson, dropRatesFor, payBlocksRemoval, removePayItem, saveListRate, saveShopDefault, setRate } from "@/lib/services/pay";

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

describe("the rate list", () => {
  it("is the owner's to keep: a rate saves, a blank takes it off, and the job has to be real", async () => {
    const { store, worker, owner, job } = await setup();
    const workerId = worker.workerId ?? "";
    expect((await saveListRate(store, worker, { workerId, scope: "usual", rate: 20 })).ok).toBe(false);
    expect((await saveListRate(store, owner, { workerId: "nobody", scope: "usual", rate: 20 })).ok).toBe(false);
    expect((await saveListRate(store, owner, { workerId, scope: "no-such-job", rate: 20 })).ok).toBe(false);
    expect((await saveListRate(store, owner, { workerId, scope: "usual", rate: -1 })).ok).toBe(false);
    expect(await store.listRates()).toHaveLength(0);

    expect((await saveListRate(store, owner, { workerId, scope: "usual", rate: 35 })).ok).toBe(true);
    expect((await saveListRate(store, owner, { workerId, scope: "shop", rate: 15 })).ok).toBe(true);
    expect((await saveListRate(store, owner, { workerId, scope: job.id, rate: 30 })).ok).toBe(true);
    // Saving again replaces, it doesn't add a second line.
    expect((await saveListRate(store, owner, { workerId, scope: "usual", rate: 36.5 })).ok).toBe(true);
    expect((await store.listRates()).map((rate) => [rate.scope, rate.rate]).sort()).toEqual([[job.id, 30], ["shop", 15], ["usual", 36.5]].sort());

    expect((await saveListRate(store, owner, { workerId, scope: "shop", rate: null })).ok).toBe(true);
    expect((await store.listRates()).map((rate) => rate.scope).sort()).toEqual([job.id, "usual"].sort());
  });

  it("fills the rate in as hours are logged, and the crew member is never shown it", async () => {
    const { store, worker, owner, job } = await setup();
    const workerId = worker.workerId ?? "";
    await saveListRate(store, owner, { workerId, scope: "usual", rate: 35 });
    await saveListRate(store, owner, { workerId, scope: "shop", rate: 15 });

    const logged = await addHours(store, worker, job.id, { date: today, hours: 4, note: "Railings" });
    if (!logged.ok) throw new Error(logged.error);
    // What goes back to the crew member is the job, and it carries no pay.
    expect(JSON.stringify(logged.data)).not.toContain("140");
    const shop = await addShopHours(store, worker, { date: today, hours: 1.5, note: "" });
    if (!shop.ok) throw new Error(shop.error);
    expect(JSON.stringify(shop.data)).not.toContain("22.5");

    const pay = await store.listPay();
    const onJob = pay.find((item) => item.kind === "pay" && item.entryId === logged.data.hours?.[0].id);
    const onShop = pay.find((item) => item.kind === "pay" && item.entryId === shop.data.id);
    expect(onJob).toMatchObject({ hours: 4, rate: 35, amount: 140, jobId: job.id, auto: true, note: "Railings" });
    expect(onShop).toMatchObject({ hours: 1.5, rate: 15, amount: 22.5, jobId: null, what: "Shop time", auto: true });
    expect(await waiting(store)).toHaveLength(0);
    expect(balances(pay)[0]).toMatchObject({ earned: 162.5, hours: 5.5 });
  });

  it("still lets a crew member take back hours whose rate was only filled in from the list, and the pay goes with them", async () => {
    const { store, worker, owner, job } = await setup();
    const workerId = worker.workerId ?? "";
    await saveListRate(store, owner, { workerId, scope: "usual", rate: 35 });
    await saveListRate(store, owner, { workerId, scope: "shop", rate: 15 });

    // A wrong number on a job and on shop time: both got a rate the moment they were logged.
    const onJob = await addHours(store, worker, job.id, { date: today, hours: 14, note: "" });
    if (!onJob.ok) throw new Error(onJob.error);
    const shop = await addShopHours(store, worker, { date: today, hours: 10, note: "" });
    if (!shop.ok) throw new Error(shop.error);
    expect(await store.listPay()).toHaveLength(2);

    expect((await removeHours(store, worker, job.id, onJob.data.hours?.[0].id ?? "")).ok).toBe(true);
    expect((await removeCrewEntry(store, worker, shop.data.id)).ok).toBe(true);
    // Nobody is owed for hours that aren't there.
    expect(await store.listPay()).toHaveLength(0);

    // Once the owner has set the rate himself, the hours are part of the record again.
    const again = await addShopHours(store, worker, { date: today, hours: 1, note: "" });
    if (!again.ok) throw new Error(again.error);
    expect((await setRate(store, owner, again.data.id, 15)).ok).toBe(true);
    expect((await removeCrewEntry(store, worker, again.data.id)).ok).toBe(false);
    expect(await store.listPay()).toHaveLength(1);
  });

  it("uses the rate for that job ahead of the usual rate, and fills it in when the owner logs the hours too", async () => {
    const { store, worker, owner, job } = await setup();
    const workerId = worker.workerId ?? "";
    await saveListRate(store, owner, { workerId, scope: "usual", rate: 35 });
    await saveListRate(store, owner, { workerId, scope: job.id, rate: 10 });
    const logged = await addHours(store, owner, job.id, { workerId, date: today, hours: 6, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    expect((await store.listPay())[0]).toMatchObject({ rate: 10, amount: 60, auto: true });
  });

  it("leaves hours waiting when it has no rate for them: shop time never takes the usual rate", async () => {
    const { store, worker, owner, job } = await setup();
    const workerId = worker.workerId ?? "";
    // Only a shop rate: job hours wait. Only a usual rate: shop time waits.
    await saveListRate(store, owner, { workerId, scope: "shop", rate: 15 });
    expect((await addHours(store, worker, job.id, { date: today, hours: 2, note: "" })).ok).toBe(true);
    expect(await store.listPay()).toHaveLength(0);
    expect(await waiting(store)).toHaveLength(1);

    await saveListRate(store, owner, { workerId, scope: "shop", rate: null });
    await saveListRate(store, owner, { workerId, scope: "usual", rate: 35 });
    expect((await addShopHours(store, worker, { date: today, hours: 1, note: "" })).ok).toBe(true);
    expect(await store.listPay()).toHaveLength(0);
    expect(await waiting(store)).toHaveLength(2);
  });

  it("has one shop time rate for everyone, so someone with no rate of their own never starts blank", async () => {
    const { store, worker, owner, job } = await setup();
    const workerId = worker.workerId ?? "";
    // The owner's only, and it has to be a sensible rate.
    expect((await saveShopDefault(store, worker, 15)).ok).toBe(false);
    expect((await saveShopDefault(store, owner, -1)).ok).toBe(false);
    expect((await saveShopDefault(store, owner, 15)).ok).toBe(true);

    // Nobody set anything for this person: their shop time is filled in at the rate for everyone.
    const first = await addShopHours(store, worker, { date: today, hours: 2, note: "" });
    if (!first.ok) throw new Error(first.error);
    expect(await store.listPay()).toHaveLength(1);
    expect((await store.listPay())[0]).toMatchObject({ entryId: first.data.id, rate: 15, amount: 30, auto: true, jobId: null });

    // Job hours don't take it: they still wait for the owner.
    expect((await addHours(store, worker, job.id, { date: today, hours: 3, note: "" })).ok).toBe(true);
    expect(await store.listPay()).toHaveLength(1);
    expect(await waiting(store)).toHaveLength(1);

    // Their own shop rate wins over the one for everyone.
    await saveListRate(store, owner, { workerId, scope: "shop", rate: 20 });
    const second = await addShopHours(store, worker, { date: today, hours: 1, note: "" });
    if (!second.ok) throw new Error(second.error);
    expect((await store.listPay()).find((item) => item.kind === "pay" && item.entryId === second.data.id)).toMatchObject({ rate: 20, amount: 20 });

    // Changing it, or taking it off, never touches hours already logged.
    expect((await saveShopDefault(store, owner, 18)).ok).toBe(true);
    expect((await saveShopDefault(store, owner, null)).ok).toBe(true);
    expect((await store.listPay()).find((item) => item.kind === "pay" && item.entryId === first.data.id)).toMatchObject({ rate: 15, amount: 30 });
    await saveListRate(store, owner, { workerId, scope: "shop", rate: null });
    expect((await addShopHours(store, worker, { date: today, hours: 1, note: "" })).ok).toBe(true);
    expect(await waiting(store)).toHaveLength(2);
    // Removing a person from the crew list doesn't take the rate for everyone with it.
    expect((await saveShopDefault(store, owner, 15)).ok).toBe(true);
    await dropRatesFor(store, workerId);
    expect((await store.listRates()).map((rate) => rate.rate)).toEqual([15]);
  });

  it("never changes hours already logged when a rate on the list changes", async () => {
    const { store, worker, owner, job } = await setup();
    const workerId = worker.workerId ?? "";
    await saveListRate(store, owner, { workerId, scope: "usual", rate: 30 });
    await addHours(store, worker, job.id, { date: today, hours: 2, note: "first" });
    await saveListRate(store, owner, { workerId, scope: "usual", rate: 35 });
    await addHours(store, worker, job.id, { date: today, hours: 2, note: "second" });
    const amounts = (await store.listPay()).map((item) => (item.kind === "pay" ? [item.note, item.rate, item.amount] : [])).sort();
    expect(amounts).toEqual([["first", 30, 60], ["second", 35, 70]]);
  });

  it("can remember a rate the owner sets by hand, for that job or for shop time", async () => {
    const { store, worker, owner, job } = await setup();
    const logged = await addHours(store, worker, job.id, { date: today, hours: 3, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    const shop = await addShopHours(store, worker, { date: today, hours: 1, note: "" });
    if (!shop.ok) throw new Error(shop.error);

    const plain = await setRate(store, owner, logged.data.hours?.[0].id ?? "", 20);
    if (!plain.ok) throw new Error(plain.error);
    expect(plain.remembered).toBe(false);
    expect(await store.listRates()).toHaveLength(0);

    const kept = await setRate(store, owner, logged.data.hours?.[0].id ?? "", 25, true);
    const keptShop = await setRate(store, owner, shop.data.id, 15, true);
    if (!kept.ok || !keptShop.ok) throw new Error("rate not set");
    expect(kept.remembered).toBe(true);
    expect((await store.listRates()).map((rate) => [rate.scope, rate.rate]).sort()).toEqual([[job.id, 25], ["shop", 15]].sort());

    // The next hours on that job, and the next shop time, get those rates by themselves.
    await addHours(store, worker, job.id, { date: today, hours: 2, note: "next" });
    await addShopHours(store, worker, { date: today, hours: 2, note: "next" });
    const next = (await store.listPay()).filter((item) => item.kind === "pay" && item.note === "next");
    expect(next.map((item) => (item.kind === "pay" ? [item.rate, item.auto] : [])).sort()).toEqual([[15, true], [25, true]]);
  });

  it("drops the 'filled in from the list' mark once the owner sets the rate himself", async () => {
    const { store, worker, owner, job } = await setup();
    await saveListRate(store, owner, { workerId: worker.workerId ?? "", scope: "usual", rate: 30 });
    const logged = await addHours(store, worker, job.id, { date: today, hours: 2, note: "" });
    if (!logged.ok) throw new Error(logged.error);
    expect((await store.listPay())[0]).toMatchObject({ auto: true, rate: 30 });
    await setRate(store, owner, logged.data.hours?.[0].id ?? "", 20);
    const [line] = await store.listPay();
    expect(line).toMatchObject({ rate: 20, amount: 40 });
    expect(line.kind === "pay" && line.auto).toBeFalsy();
    expect(await store.listPay()).toHaveLength(1);
  });

  it("changes the email's last line when the rate was filled in, without putting the rate in the email", async () => {
    const { store, worker, owner, job } = await setup();
    await saveListRate(store, owner, { workerId: worker.workerId ?? "", scope: "usual", rate: 41.25 });
    await addHours(store, worker, job.id, { date: today, hours: 2, note: "" });
    const email = (await store.listEmails()).find((item) => item.to === owner.email && item.subject.includes(" logged "));
    expect(email?.body).toContain("The rate was filled in from your rate list.");
    expect(email?.body).toContain(`/owner/pay?who=${worker.workerId}`);
    expect(email?.body).not.toContain("Set the rate for these hours");
    expect(email?.body).not.toContain("41.25");
    expect(email?.body).not.toContain("$");
  });
});

describe("a payment's method, and keeping people who have pay on record", () => {
  it("keeps how a payment was made when the owner says", async () => {
    const { store, worker, owner } = await setup();
    const workerId = worker.workerId ?? "";
    const said = await addPayment(store, owner, { workerId, date: today, amount: 100, note: "", method: "paypal" });
    const unsaid = await addPayment(store, owner, { workerId, date: today, amount: 50, note: "" });
    if (!said.ok || !unsaid.ok) throw new Error("payment not saved");
    expect(said.data.method).toBe("paypal");
    expect("method" in unsaid.data).toBe(false);
  });

  it("won't let someone with pay on record be removed from the crew list, and clears a removed person's rates", async () => {
    const { store, worker, owner } = await setup();
    const workerId = worker.workerId ?? "";
    expect(await payBlocksRemoval(store, workerId)).toBeNull();
    await saveListRate(store, owner, { workerId, scope: "usual", rate: 30 });
    const paid = await addPayment(store, owner, { workerId, date: today, amount: 25, note: "" });
    if (!paid.ok) throw new Error(paid.error);
    expect(await payBlocksRemoval(store, workerId)).toContain("pay on record");
    await removePayItem(store, owner, paid.data.id);
    expect(await payBlocksRemoval(store, workerId)).toBeNull();
    await dropRatesFor(store, workerId);
    expect(await store.listRates()).toHaveLength(0);
  });
});
