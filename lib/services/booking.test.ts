import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { customerListPrice, REVIEW_WAIT } from "@/lib/domain/copy";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { usd } from "@/lib/format";
import {
  approveWork,
  cancelBeforeWork,
  cancelOnSite,
  completeWork,
  createQuote,
  decidePriceChange,
  holdSlot,
  payJob,
  proposePriceChange,
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

  it("does not attach TV-mount notes to a painting quote", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const created = await createQuote(store, customer, {
      service: "paint",
      description: "Mount a 55-inch TV on a drywall living-room wall",
      params: { ...DEFAULT_PARAMS, rooms: 1, sqft: 150 },
      differentSite: false,
      jobSiteAddress: "",
      urgent: false,
      pickup: false,
      preferredWorkerId: null,
      photos: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.scope).toMatch(/Paint walls in 1 room/);
    expect(created.data.scope).toMatch(/150 sq ft/);
    const notes = created.data.assumptions.join(" ");
    expect(notes).not.toMatch(/TV|television|mounting bracket|wall studs/i);
    expect(notes).toMatch(/paint/i);
  });

  it("books a clear unlisted job from the library high and keeps that price when the slot is held", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const created = await createQuote(store, customer, {
      service: "other",
      description: "Install 40 feet of baseboard in the hallway",
      params: { ...DEFAULT_PARAMS },
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
    expect(created.data.quoteMeta?.kind).toBe("library");
    expect(created.data.quoteMeta?.bookable).toBe(true);
    expect(created.data.lines.some((line) => line.label === "Baseboard")).toBe(true);
    expect(created.data.travelFee).toBe(50);
    expect(created.data.total).toBe(430);
    const held = await holdSlot(store, customer, created.data.id, "earliest");
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.data.total).toBe(430);
    expect(held.data.quoteMeta?.kind).toBe("library");
    expect(held.data.lines.find((line) => line.label === "Baseboard")?.amount).toBe(345.6);
  });

  it("sends a vague unlisted job and a refer-out trade to the owner", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const vague = await createQuote(store, customer, {
      service: "other",
      description: "Fix some stuff",
      params: { ...DEFAULT_PARAMS },
      differentSite: false,
      jobSiteAddress: "",
      urgent: false,
      pickup: false,
      preferredWorkerId: null,
      photos: [],
    });
    expect(vague.ok).toBe(true);
    if (!vague.ok) return;
    expect(vague.data.status).toBe("scope_review");
    expect(vague.data.quoteMeta?.bookable).toBe(false);
    expect(vague.data.quoteMeta?.reviewReasons.some((reason) => reason === "Vague scope" || reason === "No library entry fits")).toBe(true);
    const emails = await store.listEmails();
    const customerMail = emails.find((email) => email.to === customer.email);
    const ownerMail = emails.find((email) => email.to === "dale.orvis@exconstruction.example");
    const low = usd(vague.data.quoteMeta?.rangeLow ?? 0);
    const high = usd(vague.data.quoteMeta?.rangeHigh ?? 0);
    expect(customerMail?.body).toContain(REVIEW_WAIT);
    expect(customerMail?.body).not.toContain(low);
    expect(customerMail?.body).not.toContain(high);
    expect(customerMail?.body).not.toContain("range");
    expect(ownerMail?.body).toContain(low);
    expect(ownerMail?.body).toContain(high);
    expect(customerListPrice(vague.data.status, vague.data.total, usd)).not.toContain(low);
    expect(customerListPrice(vague.data.status, vague.data.total, usd)).not.toContain(high);

    const outlets = await createQuote(store, customer, {
      service: "other",
      description: "Replace two outlets in the kitchen",
      params: { ...DEFAULT_PARAMS },
      differentSite: false,
      jobSiteAddress: "",
      urgent: false,
      pickup: false,
      preferredWorkerId: null,
      photos: [],
    });
    expect(outlets.ok).toBe(true);
    if (!outlets.ok) return;
    expect(outlets.data.status).toBe("scope_review");
    expect(outlets.data.quoteMeta?.items[0]).toMatchObject({ id: "outlet", quantity: 2 });
    expect(outlets.data.licenseLevel).not.toBe("ok");
  });

  it("still reviews a rewire when the library toggle says we do panels", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const library = await store.listLibrary();
    await store.saveLibrary(library.map((entry) => (entry.id === "panel-upgrade" ? { ...entry, performs: true } : entry)));
    const created = await createQuote(store, customer, {
      service: "other",
      description: "Rewire the electrical panel and add a circuit",
      params: { ...DEFAULT_PARAMS },
      differentSite: false,
      jobSiteAddress: "",
      urgent: false,
      pickup: false,
      preferredWorkerId: null,
      photos: [],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.status).toBe("scope_review");
    expect(created.data.licenseLevel).toBe("refer");
  });

  it("sends a clear unlisted job to review when the AI cap is used, and still quotes a listed job", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const settings = await store.getSettings();
    await store.saveSettings({ ...settings, aiDailyCap: 0 });
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    try {
      const created = await createQuote(store, customer, {
        service: "other",
        description: "Install 40 feet of baseboard in the hallway",
        params: { ...DEFAULT_PARAMS },
        differentSite: false,
        jobSiteAddress: "",
        urgent: false,
        pickup: false,
        preferredWorkerId: null,
        photos: [],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.data.status).toBe("scope_review");
      expect(`${created.data.licenseTrade} ${created.data.licenseWhy}`).toMatch(/daily AI quote limit/i);
      expect(created.data.lines.some((line) => line.label === "Baseboard")).toBe(true);

      const listed = await createQuote(store, customer, {
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
      expect(listed.ok).toBe(true);
      if (!listed.ok) return;
      expect(listed.data.status).toBe("quoted");
      expect(listed.data.total).toBe(275);

      const paint = await createQuote(store, customer, {
        service: "paint",
        description: "Paint the bedroom walls, one room, about 150 square feet",
        params: { ...DEFAULT_PARAMS, rooms: 1, sqft: 150 },
        differentSite: false,
        jobSiteAddress: "",
        urgent: false,
        pickup: false,
        preferredWorkerId: null,
        photos: [],
      });
      expect(paint.ok).toBe(true);
      if (!paint.ok) return;
      expect(paint.data.status).toBe("quoted");
      expect(paint.data.service).toBe("paint");
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  it("still books a clear unlisted job from keywords when there is no OpenAI key", async () => {
    const store = repo();
    const customer = await actor(store, DEMO_USERS.customer);
    const settings = await store.getSettings();
    await store.saveSettings({ ...settings, aiDailyCap: 0 });
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      const created = await createQuote(store, customer, {
        service: "other",
        description: "Install 40 feet of baseboard in the hallway",
        params: { ...DEFAULT_PARAMS },
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
      expect(created.data.total).toBe(430);
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });

  async function bookedTv(store: LocalRepository) {
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
    if (!created.ok) throw new Error(created.error);
    const held = await holdSlot(store, customer, created.data.id, "earliest");
    if (!held.ok) throw new Error(held.error);
    const paid = await payJob(store, customer, created.data.id, "paypal");
    if (!paid.ok) throw new Error(paid.error);
    return { customer, owner, job: paid.data };
  }

  it("refunds a cancel-on-site as paid minus travel, not the $50 fee on top", async () => {
    const store = repo();
    const { owner, job } = await bookedTv(store);
    expect(job.total).toBe(275);
    expect(job.travelFee).toBe(50);
    const cancelled = await cancelOnSite(store, owner, job.id);
    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.data.status).toBe("cancelled");
    expect(cancelled.data.priceChanges?.[0]?.outcome).toBe("cancel_on_site");
    const payments = await store.listPayments(job.id);
    const refund = payments.find((payment) => payment.kind === "refund");
    expect(refund?.amount).toBe(225);
    expect(refund?.status).toBe("pending");
    expect(refund?.note).toMatch(/travel/i);
    expect(refund?.note).toMatch(/does not apply/i);
    const started = await startWork(store, owner, job.id);
    expect(started.ok).toBe(false);
  });

  it("blocks work while a revision is pending, then collects a higher price or refunds a lower one", async () => {
    const store = repo();
    const { customer, owner, job } = await bookedTv(store);
    const proposed = await proposePriceChange(store, owner, job.id, "400", "Extra bracket and a patch");
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect(proposed.data.status).toBe("price_change");
    expect(proposed.data.total).toBe(400);
    expect(proposed.data.priceChanges?.[0]).toMatchObject({ previousTotal: 275, proposedTotal: 400, outcome: "pending" });
    expect(proposed.data.lines.find((line) => line.label === "On-site change")?.amount).toBe(125);
    expect(proposed.data.lines.reduce((sum, line) => sum + line.amount, 0)).toBe(400);

    const blocked = await startWork(store, owner, job.id);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toMatch(/approves the price change/);

    const emails = await store.listEmails();
    const notice = emails.find((email) => email.to === customer.email && email.subject.includes("New price"));
    expect(notice?.body).toContain("Extra bracket and a patch");
    expect(notice?.body).toContain(usd(275));
    expect(notice?.body).toContain(usd(400));
    expect(notice?.body).not.toMatch(/\$\d[\d,]*\.\d{2}\s*[–-]\s*\$/);

    const approved = await decidePriceChange(store, customer, job.id, "approve");
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.data.status).toBe("booked");
    expect(approved.data.amountDueNow).toBe(125);
    expect(approved.data.balanceDue).toBe(0);
    expect(approved.data.priceChanges?.[0]?.outcome).toBe("approved");
    const stillBlocked = await startWork(store, owner, job.id);
    expect(stillBlocked.ok).toBe(false);

    const paid = await payJob(store, customer, job.id, "paypal");
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.amountDueNow).toBe(0);
    expect(paid.data.status).toBe("booked");
    const started = await startWork(store, owner, job.id);
    expect(started.ok).toBe(true);

    const lowerStore = repo();
    const lower = await bookedTv(lowerStore);
    const drop = await proposePriceChange(lowerStore, lower.owner, lower.job.id, "200", "Wall was easier than described");
    expect(drop.ok).toBe(true);
    if (!drop.ok) return;
    const accepted = await decidePriceChange(lowerStore, lower.customer, lower.job.id, "approve");
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    expect(accepted.data.status).toBe("booked");
    expect(accepted.data.total).toBe(200);
    expect(accepted.data.amountDueNow).toBe(0);
    const refunds = await lowerStore.listPayments(lower.job.id);
    expect(refunds.find((payment) => payment.kind === "refund")?.amount).toBe(75);
    const go = await startWork(lowerStore, lower.owner, lower.job.id);
    expect(go.ok).toBe(true);
  });

  it("treats a declined price change like cancel on site", async () => {
    const store = repo();
    const { customer, owner, job } = await bookedTv(store);
    const proposed = await proposePriceChange(store, owner, job.id, "500", "Needs a new backing board");
    expect(proposed.ok).toBe(true);
    const declined = await decidePriceChange(store, customer, job.id, "decline");
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.data.status).toBe("cancelled");
    expect(declined.data.priceChanges?.[0]?.outcome).toBe("declined");
    expect(declined.data.priceChanges?.[0]?.previousTotal).toBe(275);
    expect(declined.data.priceChanges?.[0]?.proposedTotal).toBe(500);
    const refund = (await store.listPayments(job.id)).find((payment) => payment.kind === "refund");
    expect(refund?.amount).toBe(job.total - job.travelFee);
    expect(refund?.amount).toBe(225);
    const started = await startWork(store, owner, job.id);
    expect(started.ok).toBe(false);
  });

  it("uses the deposit rule on a revised total of $2,000", async () => {
    const store = repo();
    const { customer, owner, job } = await bookedTv(store);
    const proposed = await proposePriceChange(store, owner, job.id, "2000", "The wall needs a full rebuild");
    expect(proposed.ok).toBe(true);
    const approved = await decidePriceChange(store, customer, job.id, "approve");
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.data.amountDueNow).toBe(725);
    expect(approved.data.balanceDue).toBe(1000);
    const early = await startWork(store, owner, job.id);
    expect(early.ok).toBe(false);
  });
});
