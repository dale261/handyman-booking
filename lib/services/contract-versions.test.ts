import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser, type JobRecord, type PaymentRecord } from "@/lib/db/types";
import { acceptedAt, documentTerms, keepsEarlierTerms, NEW_TERMS_FROM } from "@/lib/domain/contract-versions";
import { DEFAULT_SETTINGS } from "@/lib/domain/settings";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { createQuote } from "@/lib/services/booking";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function quotedJob(): Promise<JobRecord> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-versions-"));
  dirs.push(dir);
  const store = new LocalRepository(dir);
  const user = await store.getUser(DEMO_USERS.customer);
  if (!user) throw new Error("missing demo user");
  const created = await createQuote(store, actorFromUser(user), {
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
  return created.data;
}

const BEFORE = new Date(new Date(NEW_TERMS_FROM).getTime() - 86_400_000).toISOString();
const AFTER = new Date(new Date(NEW_TERMS_FROM).getTime() + 86_400_000).toISOString();

function signed(job: JobRecord, at: string): JobRecord {
  return { ...job, agreement: { signedName: "Pat Tester", signedAt: at, total: job.total, ip: "", userAgent: "" } };
}

function payment(job: JobRecord, at: string): PaymentRecord {
  return { id: "pay-1", jobId: job.id, kind: "full", amount: job.total, method: "paypal", status: "paid", closed: false, note: "", paypalCaptureId: null, createdAt: at };
}

const text = (job: JobRecord, payments: PaymentRecord[]) => documentTerms(job, payments, DEFAULT_SETTINGS).flatMap((section) => section.body).join(" ");

const EARLIER_PHOTOS = "We only show them publicly if you say so when you leave a review.";
const NEW_PHOTOS = "We may post them on our website and social media";
const EARLIER_BALANCE = "Any balance is due after you approve the finished work.";
const NEW_BALANCE = "Any balance is due when the work is finished.";

describe("a customer keeps the wording they accepted", () => {
  it("prints today's wording for a price nobody has accepted yet", async () => {
    const job = await quotedJob();
    expect(acceptedAt(job, [])).toBeNull();
    expect(keepsEarlierTerms(job, [])).toBe(false);
    expect(text(job, [])).toContain(NEW_PHOTOS);
    expect(text(job, [])).toContain(NEW_BALANCE);
  });

  it("prints the earlier wording for a job signed before the change", async () => {
    const job = signed(await quotedJob(), BEFORE);
    expect(keepsEarlierTerms(job, [])).toBe(true);
    expect(text(job, [])).toContain(EARLIER_PHOTOS);
    expect(text(job, [])).toContain(EARLIER_BALANCE);
    expect(text(job, [])).not.toContain(NEW_PHOTOS);
    expect(text(job, [])).not.toContain(NEW_BALANCE);
  });

  it("counts a payment as acceptance, the same as a signature", async () => {
    const job = await quotedJob();
    expect(text(job, [payment(job, BEFORE)])).toContain(EARLIER_PHOTOS);
    expect(text(job, [payment(job, AFTER)])).toContain(NEW_PHOTOS);
  });

  it("prints today's wording for a job signed after the change", async () => {
    const job = signed(await quotedJob(), AFTER);
    expect(keepsEarlierTerms(job, [])).toBe(false);
    expect(text(job, [])).toContain(NEW_BALANCE);
  });

  it("goes by the first acceptance when there is both a payment and a later signature", async () => {
    const job = signed(await quotedJob(), AFTER);
    expect(acceptedAt(job, [payment(job, BEFORE)])).toBe(BEFORE);
    expect(text(job, [payment(job, BEFORE)])).toContain(EARLIER_PHOTOS);
  });

  it("shows white-label on an earlier agreement too", async () => {
    const job = { ...signed(await quotedJob(), BEFORE), whiteLabel: { by: "customer" as const, at: AFTER } };
    const sections = documentTerms(job, [], DEFAULT_SETTINGS);
    expect(sections[1].title).toBe("White-label service");
    expect(text(job, [])).toContain("We never post them.");
  });

  it("keeps the earlier wording on an invoice paid before the change", async () => {
    const job = { ...(await quotedJob()), workDoneOn: "2026-11-19", status: "balance_due" as const, ownerPriced: true };
    const earlier = documentTerms(job, [payment(job, BEFORE)], DEFAULT_SETTINGS);
    expect(earlier.some((section) => section.title === "Photos")).toBe(false);
    const current = documentTerms(job, [], DEFAULT_SETTINGS);
    expect(current.some((section) => section.title === "Photos")).toBe(true);
  });
});
