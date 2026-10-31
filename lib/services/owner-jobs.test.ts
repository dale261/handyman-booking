import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { sendAgreement, signAgreement, tokenMatches } from "@/lib/services/agreement";
import { holdSlot, payJob } from "@/lib/services/booking";
import { createOwnerJob } from "@/lib/services/owner-jobs";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-owner-jobs-"));
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

describe("owner-entered jobs", () => {
  it("writes the job up once: owner price, invoice number, contract link, and the price survives scheduling", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const created = await createOwnerJob(store, owner, {
      customer,
      service: "other",
      scope: "Replace kitchen faucet",
      description: "Swap the old faucet for the Moen the customer bought. Shut-offs work.",
      jobSiteAddress: "",
      hoursOnSite: 2,
      days: 1,
      crewSize: 1,
      total: 450,
      travel: 50,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const job = created.data;
    expect(job.invoiceNumber).toBe(1000);
    expect(job.status).toBe("quoted");
    expect(job.ownerPriced).toBe(true);
    expect(job.travelLocked).toBe(true);
    expect(job.total).toBe(450);
    expect(job.travelFee).toBe(50);
    expect(job.amountDueNow).toBe(450);
    expect(job.balanceDue).toBe(0);
    expect(job.onsiteMinutes).toBe(120);
    expect(job.docToken).toMatch(/^[0-9a-f]{48}$/);
    expect(job.lines.map((line) => line.amount)).toEqual([400, 50]);

    const held = await holdSlot(store, owner, job.id, "earliest", { holdHours: 72 });
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.data.status).toBe("held");
    expect(held.data.total).toBe(450);
    expect(held.data.travelFee).toBe(50);
    expect(held.data.lines.map((line) => line.amount)).toEqual([400, 50]);
    expect(held.data.onsiteMinutes).toBe(120);
    expect(held.data.invoiceNumber).toBe(1000);
    const holdMs = new Date(held.data.holdUntil || 0).getTime() - Date.now();
    expect(holdMs).toBeGreaterThan(71 * 3600 * 1000);
    expect(holdMs).toBeLessThan(73 * 3600 * 1000);
    const emails = await store.listEmails();
    const holdMail = emails.find((email) => email.to === customer.email && email.subject.includes("held for 72 hours"));
    expect(holdMail?.body).toContain(`/contract/${job.id}?k=${job.docToken}`);

    const paid = await payJob(store, owner, job.id, "check");
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.status).toBe("booked");
    expect(paid.data.total).toBe(450);
  });

  it("refuses a worker's email, a zero price, and travel above the total", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const worker = await user(store, DEMO_USERS.worker);
    const base = { service: "other" as const, scope: "Fix a door", description: "", jobSiteAddress: "", hoursOnSite: 1, days: 1, crewSize: 1, total: 200, travel: 0 };
    expect((await createOwnerJob(store, owner, { ...base, customer: worker })).ok).toBe(false);
    expect((await createOwnerJob(store, owner, { ...base, customer, total: 0 })).ok).toBe(false);
    expect((await createOwnerJob(store, owner, { ...base, customer, travel: 250 })).ok).toBe(false);
    const customerActor = actorFromUser(customer);
    expect((await createOwnerJob(store, customerActor, { ...base, customer })).ok).toBe(false);
  });

  it("lets the customer sign from the emailed link, once, and tells the owner", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const created = await createOwnerJob(store, owner, {
      customer,
      service: "paint",
      scope: "Paint the back bedroom",
      description: "Walls only, customer supplies paint.",
      jobSiteAddress: "",
      hoursOnSite: 4,
      days: 1,
      crewSize: 2,
      total: 700,
      travel: 0,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const job = created.data;
    expect(tokenMatches(job, job.docToken)).toBe(true);
    expect(tokenMatches(job, "nope")).toBe(false);
    expect(tokenMatches(job, null)).toBe(false);

    const wrong = await signAgreement(store, { jobId: job.id, actor: null, token: "wrong", signedName: "Pat Customer", ip: "1.2.3.4", userAgent: "test" });
    expect(wrong.ok).toBe(false);
    const short = await signAgreement(store, { jobId: job.id, actor: null, token: job.docToken ?? null, signedName: "P", ip: "1.2.3.4", userAgent: "test" });
    expect(short.ok).toBe(false);
    const signed = await signAgreement(store, { jobId: job.id, actor: null, token: job.docToken ?? null, signedName: "  Pat   Customer ", ip: "1.2.3.4", userAgent: "test" });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.data.agreement?.signedName).toBe("Pat Customer");
    expect(signed.data.agreement?.total).toBe(700);
    const again = await signAgreement(store, { jobId: job.id, actor: null, token: job.docToken ?? null, signedName: "Someone Else", ip: "", userAgent: "" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.data.agreement?.signedName).toBe("Pat Customer");
    const notes = await store.listNotifications();
    expect(notes.some((note) => note.kind === "signed" && note.jobId === job.id)).toBe(true);

    const sent = await sendAgreement(store, owner, job.id);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.data.docSentAt).toBeTruthy();
    const emails = await store.listEmails();
    const doc = emails.find((email) => email.to === customer.email && email.subject.includes("invoice #1000"));
    expect(doc?.body).toContain(`/contract/${job.id}?k=${job.docToken}`);
    expect(doc?.body).toContain("$700.00");
    const asCustomer = await sendAgreement(store, actorFromUser(customer), job.id);
    expect(asCustomer.ok).toBe(false);
  });
});

describe("multi-day owner jobs", () => {
  it("reserves the crew for consecutive working days, skipping Sundays, and keeps them busy on every day", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const base = { customer, service: "other" as const, description: "", jobSiteAddress: "", hoursOnSite: 8, crewSize: 2, travel: 0 };
    const trim = await createOwnerJob(store, owner, { ...base, scope: "Trim out the whole first floor", days: 3, total: 2400 });
    expect(trim.ok).toBe(true);
    if (!trim.ok) return;
    expect(trim.data.durationDays).toBe(3);
    expect(trim.data.scheduledDates).toEqual([]);

    const held = await holdSlot(store, owner, trim.data.id, "earliest");
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    const dates = held.data.scheduledDates ?? [];
    expect(dates).toHaveLength(3);
    expect(dates[0]).toBe(held.data.scheduledDate);
    expect(new Set(dates).size).toBe(3);
    for (const date of dates) expect(new Date(`${date}T12:00:00Z`).getUTCDay()).not.toBe(0);
    expect(held.data.workerIds).toHaveLength(2);
    expect(held.data.onsiteMinutes).toBe(480);
    const emails = await store.listEmails();
    const holdMail = emails.find((email) => email.to === customer.email && email.subject.startsWith("Your time is held"));
    expect(holdMail?.body).toContain("each day");

    // The same two people can't take another all-day job on the middle day.
    const other = await createOwnerJob(store, owner, { ...base, scope: "Hang doors", days: 1, total: 900 });
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    const clash = await holdSlot(store, owner, other.data.id, { date: dates[1], startMin: held.data.startMin ?? 480 });
    if (clash.ok) {
      expect(clash.data.workerIds.some((id) => held.data.workerIds.includes(id))).toBe(false);
    } else {
      expect(clash.error).toMatch(/taken|fits/);
    }
  });
});
