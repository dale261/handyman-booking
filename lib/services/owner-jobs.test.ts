import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { ensureCustomerAccount } from "@/lib/accounts";
import { invoiceOnly, invoiceSummary, invoiceTerms, longDate } from "@/lib/domain/agreement";
import { isPlaceholderEmail, realEmail } from "@/lib/domain/contact";
import { addDays, todayDetroit } from "@/lib/format";
import { editOwnerJob, setDiscount, voidInvoice } from "@/lib/services/adjust";
import { jobForLink, sendAgreement, signAgreement, tokenMatches } from "@/lib/services/agreement";
import { amountPayable, holdSlot, listOpenSlots, payJob } from "@/lib/services/booking";
import { checkDoneOn, createOwnerJob } from "@/lib/services/owner-jobs";

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
    // The hold email carried the contract link, so the job counts as sent.
    expect(held.data.docSentAt).toBeTruthy();
    expect((await store.getJob(job.id))?.docSentAt).toBeTruthy();

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

  it("lets whoever holds the emailed link pick a time and pay, with no account", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const created = await createOwnerJob(store, owner, {
      customer,
      service: "other",
      scope: "Hang a storm door",
      description: "",
      jobSiteAddress: "",
      hoursOnSite: 2,
      days: 1,
      crewSize: 1,
      total: 320,
      travel: 0,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const job = created.data;

    // The agreement email, sent with no time set, says the link is where to pick a time and pay.
    const sent = await sendAgreement(store, owner, job.id);
    expect(sent.ok).toBe(true);
    const first = (await store.listEmails()).find((email) => email.to === customer.email && email.subject.includes("invoice #1000"));
    expect(first?.body).toContain("Pick a time and pay, in either order, and read and sign the agreement, all from this link (no sign-in needed)");

    // A wrong secret opens nothing; the right one acts for the customer on this job only.
    expect(await jobForLink(store, job.id, "0000")).toBeNull();
    expect(await jobForLink(store, "missing", job.docToken)).toBeNull();
    const link = await jobForLink(store, job.id, job.docToken);
    expect(link?.actor).toMatchObject({ id: customer.id, role: "customer", workerId: null });
    if (!link) return;

    const open = await listOpenSlots(store, link.actor, job.id);
    expect(open.ok).toBe(true);
    if (!open.ok) return;
    expect(open.data.length).toBeGreaterThan(0);
    expect(open.data[0].total).toBe(320);

    // A time the crew can't make says so, and names the open times that day instead of "taken".
    const tooEarly = await holdSlot(store, owner, job.id, { date: open.data[0].date, startMin: 3 * 60 });
    expect(tooEarly.ok).toBe(false);
    if (tooEarly.ok) return;
    expect(tooEarly.error).toContain("3:00 a.m. isn't open on");
    expect(tooEarly.error).toContain("Open that day:");
    const noDay = await holdSlot(store, owner, job.id, { date: "2099-01-01", startMin: 8 * 60 });
    expect(noDay.ok).toBe(false);
    if (noDay.ok) return;
    expect(noDay.error).toContain("Nothing is open on");
    expect(noDay.error).toContain("The next open time is");
    expect((await store.getJob(job.id))?.status).toBe("quoted");

    const held = await holdSlot(store, link.actor, job.id, "earliest");
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.data.status).toBe("held");
    expect(held.data.total).toBe(320);
    expect(amountPayable(held.data)).toBe(320);
    // Not the owner, so the usual hold window applies even if a longer one is asked for.
    const settings = await store.getSettings();
    const holdMs = new Date(held.data.holdUntil || 0).getTime() - Date.now();
    expect(holdMs).toBeLessThan((settings.holdHours + 1) * 3600 * 1000);
    const holdMail = (await store.listEmails()).find((email) => email.to === customer.email && email.subject.startsWith("Your time is held"));
    expect(holdMail?.body).toContain(`/contract/${job.id}?k=${job.docToken}`);

    // Another customer's link can't touch this job.
    const stranger = { ...link.actor, id: "someone-else" };
    expect((await holdSlot(store, stranger, job.id, "earliest")).ok).toBe(false);
    expect((await payJob(store, stranger, job.id, "paypal", "CAP-STRANGER")).ok).toBe(false);

    const paid = await payJob(store, link.actor, job.id, "paypal", "CAP-LINK-1");
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.status).toBe("booked");
    expect(paid.data.amountDueNow).toBe(0);
    expect(amountPayable(paid.data)).toBe(0);
    // Cash and checks stay the owner's to record.
    expect((await payJob(store, link.actor, job.id, "cash")).ok).toBe(false);
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
      expect(clash.error).toMatch(/taken|fits|isn't open|Nothing is open/);
    }
  });
});

describe("finished work written up after the fact", () => {
  const base = {
    service: "other" as const,
    scope: "Rehang the garage door opener",
    description: "Done Thursday; customer supplied the bracket.",
    jobSiteAddress: "",
    hoursOnSite: 2,
    days: 1,
    crewSize: 1,
    total: 320,
    travel: 40,
  };

  it("skips scheduling: due in full as an invoice, paid once, and never on a crew's calendar", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const created = await createOwnerJob(store, owner, { ...base, customer, doneOn: todayDetroit() });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const job = created.data;
    expect(job.status).toBe("balance_due");
    expect(job.workDoneOn).toBe(todayDetroit());
    expect(invoiceOnly(job)).toBe(true);
    expect(job.invoiceNumber).toBe(1000);
    expect(job.scheduledDate).toBeNull();
    expect(job.crewId).toBeNull();
    expect(job.amountDueNow).toBe(0);
    expect(job.balanceDue).toBe(320);
    expect(job.payRule).toContain("Due in full");
    expect(amountPayable(job)).toBe(320);
    // Nothing to pick: the slot list refuses rather than offering times.
    expect((await listOpenSlots(store, owner, job.id)).ok).toBe(false);
    // The terms are the invoice's: no holds or cancellation rules.
    const settings = await store.getSettings();
    const titles = invoiceTerms(job, settings).map((section) => section.title);
    expect(titles).toContain("Payment");
    expect(titles).not.toContain("Cancelling or rescheduling");
    expect(titles).not.toContain("Booking and payment");
    expect(invoiceSummary(job, []).dueLabel).toContain("for the finished work");

    const sent = await sendAgreement(store, owner, job.id);
    expect(sent.ok).toBe(true);
    const emails = await store.listEmails();
    const invoiceMail = emails.find((email) => email.to === customer.email && email.subject.startsWith("Invoice #1000"));
    expect(invoiceMail?.body).toContain("$320.00 is due now");
    expect(invoiceMail?.body).toContain(`/contract/${job.id}?k=${job.docToken}`);
    expect(invoiceMail?.body).not.toContain("sign the agreement");
    expect(invoiceMail?.body).not.toContain("pick a time");

    const paid = await payJob(store, owner, job.id, "cash");
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.status).toBe("completed");
    expect(paid.data.balanceDue).toBe(0);
    expect(amountPayable(paid.data)).toBe(0);
    const payments = await store.listPayments(job.id);
    expect(payments.map((payment) => [payment.kind, payment.amount])).toEqual([["balance", 320]]);
    const receipt = (await store.listEmails()).find((email) => email.subject === "Receipt for invoice #1000: $320.00 paid");
    expect(receipt?.body).toContain("paid in full");
    // Paid: nothing more to collect, and it can't be voided.
    expect((await voidInvoice(store, owner, job.id)).ok).toBe(false);
  });

  it("checks the date: no future dates, no nonsense, nothing over a year old", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const today = todayDetroit();
    expect(checkDoneOn(today, today).ok).toBe(true);
    expect(checkDoneOn("2026-02-30", "2026-11-07").ok).toBe(false);
    expect(checkDoneOn("11/07/2026", "2026-11-07").ok).toBe(false);
    expect(checkDoneOn("2026-11-08", "2026-11-07").ok).toBe(false);
    expect(checkDoneOn("2025-11-06", "2026-11-07").ok).toBe(false);
    expect(checkDoneOn("2025-11-07", "2026-11-07").ok).toBe(true);
    const future = await createOwnerJob(store, owner, { ...base, customer, doneOn: addDays(today, 1) });
    expect(future.ok).toBe(false);
    // Blank means ordinary work to schedule.
    const blank = await createOwnerJob(store, owner, { ...base, customer, doneOn: "" });
    expect(blank.ok).toBe(true);
    if (!blank.ok) return;
    expect(blank.data.status).toBe("quoted");
    expect(invoiceOnly(blank.data)).toBe(false);
  });

  it("can be corrected or discounted before payment, and voided if it was a mistake", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const customer = await user(store, DEMO_USERS.customer);
    const today = todayDetroit();
    const created = await createOwnerJob(store, owner, { ...base, customer, doneOn: today });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const job = created.data;

    const edited = await editOwnerJob(store, owner, job.id, { scope: "Rehang the garage door opener and the sensor", description: "", total: 350, travel: 40, doneOn: addDays(today, -2) });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.data.total).toBe(350);
    expect(edited.data.balanceDue).toBe(350);
    expect(edited.data.amountDueNow).toBe(0);
    expect(edited.data.workDoneOn).toBe(addDays(today, -2));
    expect(edited.data.payRule).toContain(longDate(addDays(today, -2)));
    expect(amountPayable(edited.data)).toBe(350);

    const discounted = await setDiscount(store, owner, job.id, { amount: 50, reason: "Neighbor discount", notify: false });
    expect(discounted.ok).toBe(true);
    if (!discounted.ok) return;
    expect(discounted.data.total).toBe(300);
    expect(discounted.data.balanceDue).toBe(300);
    expect(discounted.data.amountDueNow).toBe(0);

    // Sent, then voided: the customer hears that nothing is due.
    expect((await sendAgreement(store, owner, job.id)).ok).toBe(true);
    const customerActor = actorFromUser(customer);
    expect((await voidInvoice(store, customerActor, job.id)).ok).toBe(false);
    const voided = await voidInvoice(store, owner, job.id);
    expect(voided.ok).toBe(true);
    if (!voided.ok) return;
    expect(voided.data.status).toBe("cancelled");
    expect(amountPayable(voided.data)).toBe(0);
    const notice = (await store.listEmails()).find((email) => email.subject.includes("is cancelled: nothing is due"));
    expect(notice?.to).toBe(customer.email);
    expect((await voidInvoice(store, owner, job.id)).ok).toBe(false);
    // A normal job to schedule can't be voided this way.
    const normal = await createOwnerJob(store, owner, { ...base, customer });
    expect(normal.ok).toBe(true);
    if (!normal.ok) return;
    expect((await voidInvoice(store, owner, normal.data.id)).ok).toBe(false);
  });
});

describe("phone-only customers", () => {
  it("invoices finished work with just a name and a phone: no email, no address, nothing sent", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const account = await ensureCustomerAccount(store, { fullName: "Walk-in Wanda", email: "", phone: "(231) 555-0199", billingAddress: "", billingZip: "", password: "" });
    expect(account.ok).toBe(true);
    if (!account.ok) return;
    expect(account.created).toBe(true);
    expect(isPlaceholderEmail(account.user.email)).toBe(true);
    expect(realEmail(account.user.email)).toBe("");

    const created = await createOwnerJob(store, owner, {
      customer: account.user,
      service: "other",
      scope: "Hang two shelves",
      description: "",
      jobSiteAddress: "",
      hoursOnSite: 1,
      days: 1,
      crewSize: 1,
      total: 120,
      travel: 0,
      doneOn: todayDetroit(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const job = created.data;
    expect(job.customerEmail).toBe("");
    expect(job.customerPhone).toBe("(231) 555-0199");
    expect(job.jobSiteAddress).toBe("");
    expect(job.jobZip).toBe("");
    expect(job.travelMiles).toBeNull();
    expect(job.status).toBe("balance_due");
    expect(job.invoiceNumber).toBe(1000);
    // Nothing to email: sending is refused, the link is the way.
    expect((await sendAgreement(store, owner, job.id)).ok).toBe(false);
    const paid = await payJob(store, owner, job.id, "cash");
    expect(paid.ok).toBe(true);
    if (!paid.ok) return;
    expect(paid.data.status).toBe("completed");
    // The owner still gets their notice; the customer gets nothing because there is nowhere to send it.
    const after = await store.listEmails();
    expect(after.some((email) => email.jobId === job.id)).toBe(true);
    expect(after.some((email) => email.to.trim() === "" || isPlaceholderEmail(email.to))).toBe(false);

    // The same phone number next time is the same customer, and a stand-in email typed back in is treated as blank.
    const again = await ensureCustomerAccount(store, { fullName: "", email: account.user.email, phone: "231-555-0199", billingAddress: "", billingZip: "", password: "" });
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(account.user.id);
    expect(again.user.fullName).toBe("Walk-in Wanda");
    // A customer who already has a real email is found by phone too.
    const demo = await user(store, DEMO_USERS.customer);
    const byPhone = await ensureCustomerAccount(store, { fullName: "", email: "", phone: demo.phone, billingAddress: "", billingZip: "", password: "" });
    expect(byPhone.ok).toBe(true);
    if (!byPhone.ok) return;
    expect(byPhone.user.id).toBe(demo.id);
    expect(byPhone.user.email).toBe(demo.email);
  });

  it("still needs an address for work to schedule", async () => {
    const store = repo();
    const owner = actorFromUser(await user(store, DEMO_USERS.owner));
    const account = await ensureCustomerAccount(store, { fullName: "Phone Pat", email: "", phone: "231-555-0100", billingAddress: "", billingZip: "", password: "" });
    expect(account.ok).toBe(true);
    if (!account.ok) return;
    const base = { customer: account.user, service: "other" as const, scope: "Fix a gate", description: "", hoursOnSite: 1, days: 1, crewSize: 1, total: 150, travel: 0 };
    const noAddress = await createOwnerJob(store, owner, { ...base, jobSiteAddress: "" });
    expect(noAddress.ok).toBe(false);
    const noZip = await createOwnerJob(store, owner, { ...base, jobSiteAddress: "12 Lake St, Cadillac MI" });
    expect(noZip.ok).toBe(false);
    const withZip = await createOwnerJob(store, owner, { ...base, jobSiteAddress: "12 Lake St, Cadillac MI 49601" });
    expect(withZip.ok).toBe(true);
    if (!withZip.ok) return;
    expect(withZip.data.status).toBe("quoted");
    expect(withZip.data.customerEmail).toBe("");
    expect(withZip.data.jobZip).toBe("49601");
    // No email: nothing is queued when a time is held, but the hold itself works.
    const held = await holdSlot(store, owner, withZip.data.id, "earliest", { holdHours: 24 });
    expect(held.ok).toBe(true);
    expect((await store.listEmails()).some((email) => email.jobId === withZip.data.id && (email.to.trim() === "" || isPlaceholderEmail(email.to)))).toBe(false);
  });
});
