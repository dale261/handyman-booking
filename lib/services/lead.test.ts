import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser, type Actor, type WorkerRecord } from "@/lib/db/types";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { addDays } from "@/lib/domain/hours";
import { todayDetroit } from "@/lib/format";
import { createQuote } from "@/lib/services/booking";
import { addExpense, addShopHours, changeShopHours, removeCrewEntry } from "@/lib/services/crew-log";
import { crewWeek } from "@/lib/services/crew-week";
import { addHours, changeHours, removeHours } from "@/lib/services/hours";
import { leadCrew, leadsWorker } from "@/lib/services/lead";
import { addFlatPay, addPayment, saveListRate, saveShopDefault, setRate } from "@/lib/services/pay";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-lead-"));
  dirs.push(dir);
  return new LocalRepository(dir);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const today = todayDetroit();

/** A sign-in for a crew member who has none in the demo data. Only the role, the name and the worker id are used. */
function signedIn(worker: WorkerRecord): Actor {
  return { id: `user-${worker.id}`, role: "worker", email: worker.email, fullName: worker.fullName, phone: "", workerId: worker.id };
}

/**
 * The demo crews: A and B on one crew, C and D on the other. A has a sign-in and can be
 * made the lead. A job the owner added takes hours straight away.
 */
async function setup(lead = true) {
  const store = repo();
  const get = async (id: string) => actorFromUser((await store.getUser(id))!);
  const customer = await get(DEMO_USERS.customer);
  const owner = await get(DEMO_USERS.owner);
  const a = await get(DEMO_USERS.worker);
  const workers = await store.listWorkers();
  const me = workers.find((worker) => worker.id === a.workerId)!;
  const mate = workers.find((worker) => worker.id !== me.id && worker.crewId === me.crewId)!;
  const others = workers.filter((worker) => worker.crewId !== me.crewId);
  if (lead) await store.saveWorker({ ...me, lead: true });
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
  return { store, owner, a, me, mate, mateActor: signedIn(mate), other: others[0], otherActor: signedIn(others[0]), job };
}

describe("who is a crew lead", () => {
  it("is nobody until the owner says so, and then only for the crew that person is on", async () => {
    const { store, a, me, mate, other } = await setup(false);
    expect(await leadCrew(store, a)).toBeNull();
    expect(await leadsWorker(store, a, mate.id)).toBe(false);

    await store.saveWorker({ ...me, lead: true });
    const crew = await leadCrew(store, a);
    expect(crew?.members.map((member) => member.id).sort()).toEqual([me.id, mate.id].sort());
    expect(crew?.members[0].id).toBe(me.id);
    expect(await leadsWorker(store, a, mate.id)).toBe(true);
    expect(await leadsWorker(store, a, me.id)).toBe(true);
    expect(await leadsWorker(store, a, other.id)).toBe(false);
  });

  it("stops when the tick comes off, the lead is made inactive, or they have no crew", async () => {
    const { store, owner, a, me, mate, mateActor } = await setup();
    // Being on the crew is not leading it, and the owner is never a "lead".
    expect(await leadCrew(store, mateActor)).toBeNull();
    expect(await leadCrew(store, owner)).toBeNull();
    // Someone who has left the crew list isn't shown to the lead.
    await store.saveWorker({ ...mate, active: false });
    expect((await leadCrew(store, a))?.members.map((member) => member.id)).toEqual([me.id]);

    await store.saveWorker({ ...me, lead: true, crewId: null });
    expect(await leadCrew(store, a)).toBeNull();
    await store.saveWorker({ ...me, lead: true, active: false });
    expect(await leadCrew(store, a)).toBeNull();
    await store.saveWorker({ ...me, lead: false });
    expect(await leadCrew(store, a)).toBeNull();
  });
});

describe("a lead's changes to the crew's hours", () => {
  it("adds hours and shop time for someone on the crew, and for nobody else", async () => {
    const { store, owner, a, mate, mateActor, other, job } = await setup();
    const onJob = await addHours(store, a, job.id, { workerId: mate.id, date: today, hours: 3, note: "Framing" });
    if (!onJob.ok) throw new Error(onJob.error);
    expect(onJob.data.hours?.[0]).toMatchObject({ workerId: mate.id, workerName: mate.fullName, hours: 3 });
    const shop = await addShopHours(store, a, { workerId: mate.id, date: today, hours: 1, note: "" });
    if (!shop.ok) throw new Error(shop.error);
    expect(shop.data).toMatchObject({ workerId: mate.id, hours: 1 });

    // Another crew: refused, on a job and as shop time.
    expect((await addHours(store, a, job.id, { workerId: other.id, date: today, hours: 3, note: "" })).ok).toBe(false);
    expect((await addShopHours(store, a, { workerId: other.id, date: today, hours: 1, note: "" })).ok).toBe(false);
    // Someone who isn't a lead always logs their own, whoever the form names.
    const sneaky = await addHours(store, mateActor, job.id, { workerId: a.workerId ?? "", date: addDays(today, -1), hours: 2, note: "" });
    if (!sneaky.ok) throw new Error(sneaky.error);
    expect(sneaky.data.hours?.find((entry) => entry.date === addDays(today, -1))?.workerId).toBe(mate.id);
    const sneakyShop = await addShopHours(store, mateActor, { workerId: a.workerId ?? "", date: addDays(today, -1), hours: 1, note: "" });
    if (!sneakyShop.ok) throw new Error(sneakyShop.error);
    expect(sneakyShop.data.workerId).toBe(mate.id);
    // A receipt is still each person's own, lead or not: it goes under the lead's own name.
    const receipt = await addExpense(store, a, { workerId: mate.id, date: today, amount: 12, what: "Screws" });
    if (!receipt.ok) throw new Error(receipt.error);
    expect(receipt.data.workerId).toBe(a.workerId);

    // The owner is told who did it and whose hours they are.
    const email = (await store.listEmails()).find((item) => item.to === owner.email && item.subject.includes("logged 3 hrs for"));
    expect(email?.subject).toContain(mate.fullName);
    expect(email?.body).toContain(`${a.fullName} logged 3 hrs for ${mate.fullName} on `);
  });

  it("removes a crew member's hours even when pay is set on them, and the pay goes too", async () => {
    const { store, owner, a, mateActor, other, otherActor, job } = await setup();
    const onJob = await addHours(store, mateActor, job.id, { date: today, hours: 4, note: "" });
    if (!onJob.ok) throw new Error(onJob.error);
    const entryId = onJob.data.hours?.[0].id ?? "";
    expect((await setRate(store, owner, entryId, 20)).ok).toBe(true);
    const shop = await addShopHours(store, mateActor, { date: today, hours: 1, note: "" });
    if (!shop.ok) throw new Error(shop.error);
    expect((await setRate(store, owner, shop.data.id, 15)).ok).toBe(true);
    // The crew member can't take back hours the owner has priced. Their lead can.
    expect((await removeHours(store, mateActor, job.id, entryId)).ok).toBe(false);
    expect((await removeHours(store, a, job.id, entryId)).ok).toBe(true);
    expect((await removeCrewEntry(store, a, shop.data.id)).ok).toBe(true);
    expect(await store.listPay()).toHaveLength(0);

    // Not another crew's.
    const theirs = await addHours(store, otherActor, job.id, { date: today, hours: 2, note: "" });
    if (!theirs.ok) throw new Error(theirs.error);
    const theirId = theirs.data.hours?.find((entry) => entry.workerId === other.id)?.id ?? "";
    expect((await removeHours(store, a, job.id, theirId)).ok).toBe(false);
    const theirShop = await addShopHours(store, otherActor, { date: today, hours: 1, note: "" });
    if (!theirShop.ok) throw new Error(theirShop.error);
    expect((await removeCrewEntry(store, a, theirShop.data.id)).ok).toBe(false);
    // And never a crew member's receipt.
    const receipt = await addExpense(store, mateActor, { date: today, amount: 12, what: "Screws" });
    if (!receipt.ok) throw new Error(receipt.error);
    expect((await removeCrewEntry(store, a, receipt.data.id)).ok).toBe(false);
  });

  it("changes the hours on an entry, and the pay follows at the same rate", async () => {
    const { store, owner, a, mate, mateActor, otherActor, job } = await setup();
    const onJob = await addHours(store, mateActor, job.id, { date: today, hours: 4, note: "" });
    if (!onJob.ok) throw new Error(onJob.error);
    const entryId = onJob.data.hours?.[0].id ?? "";
    expect((await setRate(store, owner, entryId, 20)).ok).toBe(true);
    const shop = await addShopHours(store, mateActor, { date: today, hours: 1, note: "" });
    if (!shop.ok) throw new Error(shop.error);

    expect((await changeHours(store, a, job.id, entryId, 6)).ok).toBe(true);
    expect((await store.getJob(job.id))?.hours?.[0]).toMatchObject({ id: entryId, workerId: mate.id, hours: 6 });
    expect((await store.listPay()).find((item) => item.kind === "pay" && item.entryId === entryId)).toMatchObject({ hours: 6, rate: 20, amount: 120 });
    // Shop time with no rate on it yet: the hours change and nothing is priced.
    expect((await changeShopHours(store, a, shop.data.id, 2.5)).ok).toBe(true);
    expect(await store.getCrewEntry(shop.data.id)).toMatchObject({ hours: 2.5 });
    expect(await store.listPay()).toHaveLength(1);

    // A bad number, a crew member who isn't the lead, and another crew's lead are all refused.
    expect((await changeHours(store, a, job.id, entryId, 0)).ok).toBe(false);
    expect((await changeHours(store, a, job.id, entryId, 1.1)).ok).toBe(false);
    expect((await changeHours(store, a, job.id, entryId, 30)).ok).toBe(false);
    expect((await changeHours(store, mateActor, job.id, entryId, 5)).ok).toBe(false);
    expect((await changeShopHours(store, mateActor, shop.data.id, 5)).ok).toBe(false);
    expect((await changeHours(store, otherActor, job.id, entryId, 5)).ok).toBe(false);
    // The owner always can.
    expect((await changeHours(store, owner, job.id, entryId, 5)).ok).toBe(true);
    expect((await store.listPay()).find((item) => item.kind === "pay" && item.entryId === entryId)).toMatchObject({ hours: 5, amount: 100 });

    const changes = (await store.listEmails()).filter((item) => item.to === owner.email && item.subject.includes("changed"));
    // One for the job hours and one for the shop time. The owner's own change sends nothing.
    expect(changes).toHaveLength(2);
    const email = changes.find((item) => item.body.includes("'s hours on "));
    expect(email?.body).toContain(`${a.fullName} changed ${mate.fullName}'s hours on `);
    expect(email?.body).toContain("from 4 hrs to 6 hrs");
    expect(email?.body).toContain("The pay on these hours was worked out again at the same rate.");
    expect(changes.find((item) => item.body.includes("'s shop time for "))?.body).toContain("from 1 hr to 2.5 hrs");
    // No rate or pay in the emails, as always.
    for (const item of changes) expect(item.body).not.toContain("$");
  });
});

describe("what a lead sees", () => {
  it("is the crew's hours with the rate and pay on each, and nothing about payments, balances or another crew", async () => {
    const { store, owner, a, me, mate, mateActor, other, otherActor, job } = await setup();
    await saveShopDefault(store, owner, 15);
    await saveListRate(store, owner, { workerId: mate.id, scope: job.id, rate: 22 });
    await saveListRate(store, owner, { workerId: other.id, scope: "usual", rate: 41.37 });
    // The crew: priced job hours and shop time for the crewmate, unpriced job hours for the lead.
    expect((await addHours(store, mateActor, job.id, { date: today, hours: 4, note: "Railings" })).ok).toBe(true);
    expect((await addShopHours(store, mateActor, { date: today, hours: 2, note: "" })).ok).toBe(true);
    expect((await addHours(store, a, job.id, { date: today, hours: 3, note: "" })).ok).toBe(true);
    // Flat pay dated this week shows as pay. A payment never shows.
    expect((await addFlatPay(store, owner, { workerId: mate.id, date: today, amount: 77, what: "Bonus for the weekend" })).ok).toBe(true);
    expect((await addPayment(store, owner, { workerId: mate.id, date: today, amount: 333.33, note: "paid in cash at the shop" })).ok).toBe(true);
    // The other crew: hours, pay and a payment.
    expect((await addHours(store, otherActor, job.id, { date: today, hours: 5, note: "other crew note" })).ok).toBe(true);
    expect((await addPayment(store, owner, { workerId: other.id, date: today, amount: 444.44, note: "" })).ok).toBe(true);

    const view = await crewWeek(store, a, today);
    if (!view) throw new Error("the lead should see their crew");
    expect(view.crewName).toBe("Crew 1");
    expect(view.members.map((member) => member.id)).toEqual([me.id, mate.id]);
    const mine = view.members[0];
    expect(mine).toMatchObject({ me: true, hours: 3, earned: 0, waiting: 3 });
    expect(mine.entries[0]).toMatchObject({ hours: 3, rate: null, pay: null });
    const theirs = view.members[1];
    expect(theirs).toMatchObject({ me: false, hours: 6, earned: 88 + 30 + 77, waiting: 0 });
    expect(theirs.entries.find((entry) => entry.jobId === job.id)).toMatchObject({ hours: 4, rate: 22, pay: 88, note: "Railings" });
    expect(theirs.entries.find((entry) => !entry.jobId)).toMatchObject({ hours: 2, rate: 15, pay: 30, what: "Shop time" });
    expect(theirs.other).toHaveLength(1);
    expect(theirs.other[0]).toMatchObject({ amount: 77, what: "Bonus for the weekend", hours: null, rate: null });

    // Nothing in it gives away a payment, the other crew, or that crew's rate.
    const text = JSON.stringify(view);
    for (const secret of ["333.33", "444.44", "paid in cash", other.id, other.fullName, "other crew note", "41.37", "206.85", "payment", "owed", "paid"]) expect(text).not.toContain(secret);

    // Another week is another page of the same thing, and holds none of this week's lines.
    const before = await crewWeek(store, a, addDays(today, -7));
    expect(before?.members.every((member) => member.entries.length === 0 && member.other.length === 0)).toBe(true);
  });

  it("is nothing at all for a crew member who isn't a lead, for the other crew's people, and for the owner", async () => {
    const { store, owner, mateActor, otherActor } = await setup();
    expect(await crewWeek(store, mateActor, today)).toBeNull();
    expect(await crewWeek(store, otherActor, today)).toBeNull();
    expect(await crewWeek(store, owner, today)).toBeNull();
  });
});
