import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { addDays } from "@/lib/domain/hours";
import { balances } from "@/lib/domain/pay";
import { todayDetroit } from "@/lib/format";
import { addShopHours } from "@/lib/services/crew-log";
import { addPayment, setRate } from "@/lib/services/pay";
import { checkPayFile, clearLoadedPay, loadId, loadPayFile } from "@/lib/services/pay-load";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-load-"));
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
const day = (back: number) => addDays(today, -back);
const HEAD = "date,worker,job,job_number,hours,rate,pay,note";

async function setup() {
  const store = repo();
  const worker = await actor(store, DEMO_USERS.worker);
  const owner = await actor(store, DEMO_USERS.owner);
  const me = (await store.listWorkers()).find((item) => item.id === worker.workerId);
  if (!me) throw new Error("demo worker missing");
  // The file calls this crew member by their full name; Hank and Fran aren't on the crew list.
  const file = [
    HEAD,
    `${day(9)},${me.fullName},deck,,8,15,120,owed`,
    `${day(9)},Hank Helper,deck,,6,10,60,new worker`,
    `${day(8)},Hank Helper,payment,,,,-50,paid $50`,
    `${day(8)},Fran Flat,siding,,,,200,flat rate`,
    `${day(7)},${me.fullName},payment,,,,-100,paid $100`,
    `${day(2)},${me.fullName},shop time,,1.5,15,22.50,`,
  ].join("\n");
  return { store, worker, owner, me, file };
}

describe("checking a records file", () => {
  it("says what would happen and saves nothing", async () => {
    const { store, worker, owner, me, file } = await setup();
    expect((await checkPayFile(store, worker, file, {})).ok).toBe(false);
    expect((await checkPayFile(store, owner, "  ", {})).ok).toBe(false);
    const before = (await store.listWorkers()).length;
    const checked = await checkPayFile(store, owner, file, {});
    if (!checked.ok) throw new Error(checked.error);
    expect(checked.data.read).toBe(6);
    expect(checked.data.people.map((person) => [person.name, person.choice])).toEqual([
      [me.fullName, me.id],
      ["Hank Helper", "new"],
      ["Fran Flat", "new"],
    ]);
    expect(checked.data.counts).toMatchObject({ hourly: 3, flat: 1, payments: 2, adding: 6 });
    expect(checked.data.crew.some((person) => person.id === me.id)).toBe(true);
    // The lines themselves never go to the screen.
    expect(Object.keys(checked.data)).not.toContain("items");
    expect(await store.listPay()).toHaveLength(0);
    expect((await store.listWorkers()).length).toBe(before);
  });
});

describe("loading a records file", () => {
  it("adds the people who aren't on the crew list, saves every line, and gives the file's balances", async () => {
    const { store, worker, owner, me, file } = await setup();
    expect((await loadPayFile(store, worker, file, {})).ok).toBe(false);
    const loaded = await loadPayFile(store, owner, file, {});
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.data).toMatchObject({ added: 6, linked: 0, skipped: 0, removed: 0, people: ["Hank Helper", "Fran Flat"] });

    const hank = (await store.listWorkers()).find((item) => item.fullName === "Hank Helper");
    expect(hank).toMatchObject({ active: false, crewId: null, profileId: null, email: "" });
    const pay = await store.listPay();
    expect(pay).toHaveLength(6);
    expect(pay.every((item) => item.loaded === true)).toBe(true);
    expect(pay.every((item) => !item.workerId.startsWith("new:"))).toBe(true);
    expect(balances(pay).map((person) => [person.workerName, person.earned, person.paid, person.owed])).toEqual([
      ["Fran Flat", 200, 0, 200],
      [me.fullName, 142.5, 100, 42.5],
      ["Hank Helper", 60, 50, 10],
    ]);
  });

  it("can be run twice without doubling anything, and a newer file replaces the older load", async () => {
    const { store, owner, me, file } = await setup();
    const first = await loadPayFile(store, owner, file, {});
    const second = await loadPayFile(store, owner, file, {});
    if (!first.ok || !second.ok) throw new Error("load failed");
    expect(second.data).toMatchObject({ added: 6, removed: 0, people: [] });
    expect(await store.listPay()).toHaveLength(6);
    expect((await store.listWorkers()).filter((item) => item.fullName === "Hank Helper")).toHaveLength(1);

    const newer = [HEAD, `${day(9)},${me.fullName},deck,,8,15,120,owed`, `${day(9)},Hank Helper,deck,,6,12,72,corrected`].join("\n");
    const third = await loadPayFile(store, owner, newer, {});
    if (!third.ok) throw new Error(third.error);
    expect(third.data).toMatchObject({ added: 2, removed: 5 });
    expect(balances(await store.listPay()).map((person) => [person.workerName, person.owed])).toEqual([
      [me.fullName, 120],
      ["Hank Helper", 72],
    ]);
  });

  it("works around what is already on the site: logged hours get the rate, a set rate and a recorded payment are left alone", async () => {
    const { store, worker, owner, me, file } = await setup();
    const shop = await addShopHours(store, { ...worker, fullName: me.fullName }, { date: day(2), hours: 1.5, note: "Scraped a sign" });
    if (!shop.ok) throw new Error(shop.error);
    const paid = await addPayment(store, owner, { workerId: me.id, date: day(7), amount: 100, note: "Cash" });
    if (!paid.ok) throw new Error(paid.error);

    const loaded = await loadPayFile(store, owner, file, {});
    if (!loaded.ok) throw new Error(loaded.error);
    expect(loaded.data).toMatchObject({ added: 5, linked: 1, skipped: 1 });
    const pay = await store.listPay();
    expect(pay.filter((item) => item.kind === "payment" && item.workerId === me.id)).toHaveLength(1);
    expect(pay.find((item) => item.kind === "pay" && item.entryId === shop.data.id)).toMatchObject({ rate: 15, amount: 22.5, loaded: true });
    expect(balances(pay).find((person) => person.workerId === me.id)).toMatchObject({ earned: 142.5, paid: 100, owed: 42.5 });

    // Once the owner has set the rate himself, a reload leaves that line as his.
    await setRate(store, owner, shop.data.id, 20);
    const again = await loadPayFile(store, owner, file, {});
    if (!again.ok) throw new Error(again.error);
    expect(again.data).toMatchObject({ linked: 0, skipped: 2 });
    const line = (await store.listPay()).find((item) => item.kind === "pay" && item.entryId === shop.data.id);
    expect(line).toMatchObject({ rate: 20, amount: 30 });
    expect(line?.loaded).toBeUndefined();
  });

  it("loads nothing when a line can't be read", async () => {
    const { store, owner, file } = await setup();
    const broken = `${file}\nnot a day,Hank Helper,deck,,6,10,60,`;
    const result = await loadPayFile(store, owner, broken, {});
    expect(result.ok).toBe(false);
    expect(await store.listPay()).toHaveLength(0);
    expect((await store.listWorkers()).some((item) => item.fullName === "Hank Helper")).toBe(false);
  });

  it("can be undone, leaving what was entered on the site", async () => {
    const { store, worker, owner, me, file } = await setup();
    await addPayment(store, owner, { workerId: me.id, date: day(1), amount: 25, note: "On the site" });
    await loadPayFile(store, owner, file, {});
    expect((await clearLoadedPay(store, worker)).ok).toBe(false);
    const cleared = await clearLoadedPay(store, owner);
    if (!cleared.ok) throw new Error(cleared.error);
    expect(cleared.data).toBe(6);
    const left = await store.listPay();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatchObject({ kind: "payment", amount: 25 });
  });
});

describe("the id a line is saved under", () => {
  it("is a UUID that depends only on the line", () => {
    expect(loadId("a")).toBe(loadId("a"));
    expect(loadId("a")).not.toBe(loadId("b"));
    expect(loadId("a")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
