import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import {
  approveWork,
  cancelBeforeWork,
  completeWork,
  createQuote,
  holdSlot,
  payJob,
  reassignCrew,
  requestCancel,
  resolveCancel,
  startWork,
} from "@/lib/services/booking";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-booking-"));
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

describe("booking flow", () => {
  it("issues invoice 1000, locks travel when paid, and keeps $50 on cancel", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const owner = await actor(store, DEMO_USERS.owner);
    const created = await createQuote(store, customer, {
      service: "tv",
      description: "Mount a 55-inch TV on a drywall living-room wall",
      params: { ...DEFAULT_PARAMS, tvSize: "55", wall: "drywall", conceal: "none" },
      differentSite: false,
      jobSiteAddress: "",
      urgent: false,
      pickup: false,
      preferredWorkerId: null,
      photos: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.status).toBe("quoted");
    expect(created.data.lines.some((line) => line.kind === "premium")).toBe(false);
    expect(created.data.travelFee).toBe(50);
    expect(created.data.total).toBe(275);
    expect(created.data.balanceDue).toBe(0);

    const held = await holdSlot(store, customer, created.data.id, "earliest");
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.data.invoiceNumber).toBe(1000);
    expect(held.data.status).toBe("held");
    expect(held.data.crewId).toBeTruthy();
    expect(held.data.travelLocked).toBe(false);

    const paid = await payJob(store, customer, created.data.id, "paypal");
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.status).toBe("booked");
    expect(paid.data.travelLocked).toBe(true);
    const lockedMiles = paid.data.travelMiles;

    const crews = await store.listCrews();
    const other = crews.find((crew) => crew.id !== paid.data.crewId);
    expect(other).toBeTruthy();
    const moved = await reassignCrew(store, owner, paid.data.id, other!.id);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.data.travelLocked).toBe(true);
    expect(moved.data.travelMiles).toBe(lockedMiles);
    expect(moved.data.crewId).toBe(other!.id);

    const cancelled = await cancelBeforeWork(store, customer, paid.data.id, "cancel");
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.data.fee).toBe(50);
    expect(cancelled.data.refund).toBe(225);
    expect(cancelled.data.job.status).toBe("cancelled");

    const second = await createQuote(store, customer, {
      service: "furniture",
      description: "Assemble one medium bookshelf in the office",
      params: { ...DEFAULT_PARAMS, items: 1, itemKind: "medium" },
      differentSite: false,
      jobSiteAddress: "",
      urgent: false,
      pickup: false,
      preferredWorkerId: null,
      photos: [],
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const heldAgain = await holdSlot(store, customer, second.data.id, "earliest");
    expect(heldAgain.ok).toBe(true);
    if (!heldAgain.ok) return;
    expect(heldAgain.data.invoiceNumber).toBe(1001);
  });

  it("sends pre-1978 painting to the owner and premiums Grand Traverse labor only", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const oldHouse = await createQuote(store, customer, {
      service: "paint",
      description: "Repaint two bedrooms in our 1955 farmhouse, some peeling paint on the trim",
      params: { ...DEFAULT_PARAMS, rooms: 2, sqft: 300, pre1978: true },
      differentSite: false,
      jobSiteAddress: "",
      urgent: false,
      pickup: false,
      preferredWorkerId: null,
      photos: [],
    });
    expect(oldHouse.ok).toBe(true);
    if (!oldHouse.ok) return;
    expect(oldHouse.data.status).toBe("scope_review");
    expect(oldHouse.data.licenseTrade).toMatch(/RRP/);

    const north = await createQuote(store, customer, {
      service: "helper",
      description: "Two helpers to move furniture and boxes into the garage",
      params: { ...DEFAULT_PARAMS, helpers: 2, hours: 4 },
      differentSite: true,
      jobSiteAddress: "640 Front St, Traverse City, MI 49686",
      urgent: true,
      pickup: true,
      preferredWorkerId: null,
      photos: [],
    });
    expect(north.ok).toBe(true);
    if (!north.ok) return;
    expect(north.data.county).toBe("Grand Traverse");
    expect(north.data.status).toBe("quoted");
    const premium = north.data.lines.find((line) => line.kind === "premium");
    const travel = north.data.lines.find((line) => line.kind === "travel");
    expect(premium?.amount).toBe(160);
    expect(travel?.amount).toBeGreaterThanOrEqual(50);
    expect(north.data.lines.some((line) => line.kind === "urgency" || line.kind === "pickup")).toBe(false);
    expect(north.data.total).toBe(800 + 160 + (travel?.amount ?? 0));
  });

  it("requires the owner to type a refund after work has started, and splits a $1,500+ job in half", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const owner = await actor(store, DEMO_USERS.owner);
    const created = await createQuote(store, customer, {
      service: "paint",
      description: "Repaint the living room, dining room, hallway and two bedrooms",
      params: { ...DEFAULT_PARAMS, rooms: 1, sqft: 1400, height: "8", cond: "good", doors: 0, colors: 1, ceilings: false },
      differentSite: false,
      jobSiteAddress: "",
      urgent: false,
      pickup: false,
      preferredWorkerId: null,
      photos: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.total).toBeGreaterThanOrEqual(1500);
    expect(created.data.amountDueNow).toBeCloseTo(created.data.total / 2, 1);
    expect(created.data.amountDueNow + created.data.balanceDue).toBeCloseTo(created.data.total, 2);

    const held = await holdSlot(store, customer, created.data.id, "earliest");
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    const paid = await payJob(store, owner, created.data.id, "check");
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.status).toBe("booked");

    const started = await startWork(store, owner, created.data.id);
    expect(started.ok).toBe(true);
    const early = await cancelBeforeWork(store, customer, created.data.id, "cancel");
    expect(early.ok).toBe(false);

    const asked = await requestCancel(store, customer, created.data.id);
    expect(asked.ok).toBe(true);
    const blank = await resolveCancel(store, owner, created.data.id, "approve", "");
    expect(blank.ok).toBe(false);
    const approved = await resolveCancel(store, owner, created.data.id, "approve", "40");
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.data.status).toBe("cancelled");
    const payments = await store.listPayments(created.data.id);
    const refund = payments.find((payment) => payment.kind === "refund");
    expect(refund?.amount).toBe(40);
    expect(refund?.status).toBe("pending");
  });

  it("notifies on completion before the customer approves", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const owner = await actor(store, DEMO_USERS.owner);
    const created = await createQuote(store, customer, {
      service: "clean",
      description: "Routine kitchen and bathroom cleaning",
      params: { ...DEFAULT_PARAMS, hours: 3, deep: false },
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
    const done = await completeWork(store, owner, created.data.id, "Finished and swept up.");
    if (!done.ok) throw new Error(done.error);
    expect(done.data.status).toBe("awaiting_approval");
    const notes = await store.listNotifications();
    expect(notes.some((note) => note.title.includes("awaiting customer approval"))).toBe(true);
    const approved = await approveWork(store, customer, created.data.id);
    if (!approved.ok) throw new Error(approved.error);
    expect(approved.data.status).toBe("completed");
  });
});
