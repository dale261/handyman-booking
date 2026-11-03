import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { clearDiscount, editOwnerJob, setDiscount } from "@/lib/services/adjust";
import { createQuote, holdSlot, payJob } from "@/lib/services/booking";
import { createOwnerJob } from "@/lib/services/owner-jobs";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-adjust-"));
  dirs.push(dir);
  return new LocalRepository(dir);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function user(store: LocalRepository, id: string) {
  const found = await store.getUser(id);
  if (!found) throw new Error("missing demo user");
  return found;
}

describe("discounts", () => {
  it("takes a discount off an unpaid phone job, shows it as a line, and survives scheduling", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const created = await createOwnerJob(store, owner, {
      customer, service: "other", scope: "Replace kitchen faucet", description: "", jobSiteAddress: "", hoursOnSite: 2, days: 1, crewSize: 1, total: 450, travel: 50,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const customerActor = actorFromUser(customer);
    expect((await setDiscount(store, customerActor, created.data.id, { amount: 50, reason: "x", notify: false })).ok).toBe(false);
    expect((await setDiscount(store, owner, created.data.id, { amount: 0, reason: "x", notify: false })).ok).toBe(false);
    expect((await setDiscount(store, owner, created.data.id, { amount: 450, reason: "x", notify: false })).ok).toBe(false);

    const discounted = await setDiscount(store, owner, created.data.id, { amount: 50, reason: "Neighbor discount", notify: true });
    expect(discounted.ok).toBe(true);
    if (!discounted.ok) return;
    expect(discounted.data.total).toBe(400);
    expect(discounted.data.amountDueNow).toBe(400);
    const line = discounted.data.lines.find((item) => item.kind === "discount");
    expect(line?.amount).toBe(-50);
    expect(line?.detail).toBe("Neighbor discount");
    expect(discounted.data.priceChanges?.at(-1)?.reason).toBe("Discount: Neighbor discount");
    const emails = await store.listEmails();
    expect(emails.some((email) => email.to === customer.email && email.subject.includes("$400.00"))).toBe(true);

    // Changing the discount replaces it rather than stacking.
    const again = await setDiscount(store, owner, created.data.id, { amount: 75, reason: "Repeat customer", notify: false });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.data.total).toBe(375);
    expect(again.data.lines.filter((item) => item.kind === "discount")).toHaveLength(1);

    const held = await holdSlot(store, owner, created.data.id, "earliest");
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.data.total).toBe(375);
    expect(held.data.amountDueNow).toBe(375);

    const paid = await payJob(store, owner, created.data.id, "cash");
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    // Paid in full: no discount can go below what was paid.
    expect((await setDiscount(store, owner, created.data.id, { amount: 100, reason: "late", notify: false })).ok).toBe(false);
  });

  it("comes off the balance of a half-down job and can be removed again", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const created = await createOwnerJob(store, owner, {
      customer, service: "other", scope: "Build a deck", description: "", jobSiteAddress: "", hoursOnSite: 8, days: 2, crewSize: 2, total: 3000, travel: 0,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const held = await holdSlot(store, owner, created.data.id, "earliest");
    expect(held.ok).toBe(true);
    const paid = await payJob(store, owner, created.data.id, "check");
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.balanceDue).toBe(1500);

    const discounted = await setDiscount(store, owner, created.data.id, { amount: 300, reason: "Supplied their own lumber", notify: false });
    expect(discounted.ok).toBe(true);
    if (!discounted.ok) return;
    expect(discounted.data.total).toBe(2700);
    expect(discounted.data.balanceDue).toBe(1200);
    expect(discounted.data.amountDueNow).toBe(0);
    expect((await setDiscount(store, owner, created.data.id, { amount: 1600, reason: "too much", notify: false })).ok).toBe(false);

    const cleared = await clearDiscount(store, owner, created.data.id);
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.data.total).toBe(3000);
    expect(cleared.data.balanceDue).toBe(1500);
    expect(cleared.data.lines.some((item) => item.kind === "discount")).toBe(false);
    expect(cleared.data.discount).toBeNull();
  });

  it("keeps a discount on an instant quote when the time is picked and travel is re-measured", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = actorFromUser(await user(store, DEMO_USERS.customer));
    const created = await createQuote(store, customer, {
      service: "tv",
      description: "Mount a 55-inch TV on a drywall living-room wall",
      params: { ...DEFAULT_PARAMS, tvSize: "55", wall: "drywall", conceal: "none" },
      differentSite: false, jobSiteAddress: "", urgent: false, pickup: false, preferredWorkerId: null, photos: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.total).toBe(275);
    const discounted = await setDiscount(store, owner, created.data.id, { amount: 25, reason: "Thanks for the referral", notify: false });
    expect(discounted.ok).toBe(true);
    if (!discounted.ok) return;
    expect(discounted.data.total).toBe(250);
    const held = await holdSlot(store, customer, created.data.id, "earliest");
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.data.total).toBe(250);
    expect(held.data.lines.filter((item) => item.kind === "discount")).toHaveLength(1);
    expect(held.data.amountDueNow).toBe(250);
  });
});

describe("fixing an owner-entered write-up", () => {
  it("rebuilds the lines from the new price, keeps the discount, and refuses once money is in", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const created = await createOwnerJob(store, owner, {
      customer, service: "other", scope: "Replace kitchen faucet", description: "Old one", jobSiteAddress: "", hoursOnSite: 2, days: 1, crewSize: 1, total: 450, travel: 50,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await setDiscount(store, owner, created.data.id, { amount: 50, reason: "Neighbor", notify: false });
    const edited = await editOwnerJob(store, owner, created.data.id, { scope: "Replace kitchen faucet and shut-offs", description: "Both shut-offs too", total: 600, travel: 60, hoursOnSite: 3, days: 1 });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.data.scope).toBe("Replace kitchen faucet and shut-offs");
    expect(edited.data.lines.map((item) => item.amount)).toEqual([540, 60, -50]);
    expect(edited.data.total).toBe(550);
    expect(edited.data.travelFee).toBe(60);
    expect(edited.data.onsiteMinutes).toBe(180);
    expect(edited.data.amountDueNow).toBe(550);

    const held = await holdSlot(store, owner, created.data.id, "earliest");
    expect(held.ok).toBe(true);
    await payJob(store, owner, created.data.id, "cash");
    const refused = await editOwnerJob(store, owner, created.data.id, { scope: "Something", description: "", total: 100, travel: 0 });
    expect(refused.ok).toBe(false);
  });
});
