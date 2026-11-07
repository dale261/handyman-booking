import type { Repository } from "@/lib/db/repository";
import type { Actor, JobRecord, JobStatus } from "@/lib/db/types";
import { invoiceOnly, longDate, ownerPriceLines } from "@/lib/domain/agreement";
import { grossTotal, withDiscount } from "@/lib/domain/discount";
import { roundCents } from "@/lib/domain/money";
import { splitPayment } from "@/lib/domain/pricing";
import { contractUrl, todayDetroit, usd } from "@/lib/format";
import { amountPaid, emailFooter, mail } from "@/lib/services/booking";
import { checkDoneOn, OWNER_JOB_LIMITS } from "@/lib/services/owner-jobs";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

/** Nothing paid yet: the whole deposit rule is recomputed from the new total. */
const UNPAID: JobStatus[] = ["scope_review", "quoted", "released", "pending_area", "held"];
/** Money is in: the discount comes off what is still owed. */
const PAID: JobStatus[] = ["booked", "in_progress", "awaiting_approval", "disputed", "balance_due"];

/**
 * Put the job's money fields back in step with its lines after the owner changed the price.
 * Returns an error message when the new total is below what the customer already paid.
 */
function settleMoney(job: JobRecord, paid: number, threshold: number): string | null {
  if (UNPAID.includes(job.status)) {
    const split = splitPayment(job.total, threshold);
    job.amountDueNow = split.now;
    job.balanceDue = split.later;
    job.payRule = split.rule;
    return null;
  }
  if (job.total < paid) {
    return `They've already paid ${usd(paid)}. A price below that needs a refund instead; use the refund tools on the job page.`;
  }
  job.balanceDue = roundCents(job.total - paid);
  return null;
}

function priceChangeNote(job: JobRecord, previousTotal: number, reason: string) {
  job.priceChanges = [
    ...(job.priceChanges ?? []),
    { at: new Date().toISOString(), reason, previousTotal, proposedTotal: job.total, outcome: "approved" },
  ];
}

/** Owner only: give a discount, or change it. The reason prints on the invoice. */
export async function setDiscount(
  repo: Repository,
  actor: Actor,
  jobId: string,
  input: { amount: number; reason: string; notify: boolean },
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can change a price this way.");
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (!UNPAID.includes(job.status) && !PAID.includes(job.status)) {
      return fail(job.status === "completed" || job.status === "reviewed" ? "This job is paid in full. Use a refund instead." : "This job can't take a discount from its current step.");
    }
    if (job.status === "price_change") return fail("A price change is waiting on the customer. Settle that first.");
    if (job.status === "booked" && job.amountDueNow > 0) return fail("An extra amount from a price change is still unpaid. Settle that first.");
    const amount = roundCents(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) return fail("Enter the discount as a dollar amount above zero.");
    const gross = grossTotal(job.lines);
    if (amount >= gross) return fail(`The discount has to be less than the ${usd(gross)} price.`);
    const reason = input.reason.replace(/\s+/g, " ").trim().slice(0, 120) || "Discount";
    const settings = await repo.getSettings();
    const payments = await repo.listPayments(job.id);
    const paid = amountPaid(payments, job.id);
    const previousTotal = job.total;
    job.discount = { amount, reason, at: new Date().toISOString() };
    const priced = withDiscount(job.lines, job.discount);
    job.lines = priced.lines;
    job.total = priced.total;
    const problem = settleMoney(job, paid, settings.depositThreshold);
    if (problem) return fail(problem);
    priceChangeNote(job, previousTotal, `Discount: ${reason}`);
    const saved = await repo.saveJob(job, { skipOverlap: true });
    if (input.notify && saved.customerEmail.trim()) {
      await mail(
        repo,
        saved.customerEmail,
        `New price for ${saved.scope || "your job"}: ${usd(saved.total)}`,
        `Hi ${saved.customerName}, we took ${usd(amount)} off (${reason}). The price for ${saved.scope || "your job"} is now ${usd(saved.total)}${saved.invoiceNumber ? `, invoice #${saved.invoiceNumber}` : ""}.${paid > 0 ? ` You've paid ${usd(paid)}; ${usd(saved.balanceDue)} is still due after the work is done and you approve it.` : ""}\n\nYour agreement and invoice: ${contractUrl(saved)}${emailFooter(settings)}`,
        saved.id,
      );
    }
    return { ok: true, data: saved };
  });
}

/** Owner only: take the discount back off. */
export async function clearDiscount(repo: Repository, actor: Actor, jobId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can change a price this way.");
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (!job.discount) return { ok: true, data: job };
    if (!UNPAID.includes(job.status) && !PAID.includes(job.status)) return fail("This job can't change price from its current step.");
    if (job.status === "price_change") return fail("A price change is waiting on the customer. Settle that first.");
    const settings = await repo.getSettings();
    const payments = await repo.listPayments(job.id);
    const paid = amountPaid(payments, job.id);
    const previousTotal = job.total;
    const reason = job.discount.reason;
    job.discount = null;
    const priced = withDiscount(job.lines, null);
    job.lines = priced.lines;
    job.total = priced.total;
    const problem = settleMoney(job, paid, settings.depositThreshold);
    if (problem) return fail(problem);
    priceChangeNote(job, previousTotal, `Discount removed: ${reason}`);
    const saved = await repo.saveJob(job, { skipOverlap: true });
    return { ok: true, data: saved };
  });
}

export type OwnerJobEdit = {
  scope: string;
  description: string;
  total: number;
  travel: number;
  /** Only while nothing is scheduled; blank keeps the current value. */
  hoursOnSite?: number | null;
  days?: number | null;
  /** Invoices for finished work only: the date the work was done. Blank keeps the current date. */
  doneOn?: string | null;
};

/**
 * Owner only, owner-entered jobs only, before any payment: fix the write-up.
 * The price lines are rebuilt from the new numbers and any discount stays on.
 */
export async function editOwnerJob(repo: Repository, actor: Actor, jobId: string, input: OwnerJobEdit): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can edit a job.");
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (!job.ownerPriced) return fail("Only jobs you typed in can be edited this way. Use a discount or an on-site price change for quoted jobs.");
    const invoice = invoiceOnly(job);
    if (!UNPAID.includes(job.status) && !(invoice && job.status === "balance_due")) return fail("This job has a payment on it. Use a discount or an on-site price change instead.");
    const payments = await repo.listPayments(job.id);
    if (amountPaid(payments, job.id) > 0) return fail("This job has a payment on it. Use a discount instead.");
    if (invoice && input.doneOn && input.doneOn.trim()) {
      const checked = checkDoneOn(input.doneOn, todayDetroit());
      if (!checked.ok) return fail(checked.error);
      job.workDoneOn = checked.date;
    }
    const scope = input.scope.replace(/\s+/g, " ").trim();
    if (scope.length < 3 || scope.length > 120) return fail("Give the job a short title, 3 to 120 characters.");
    const total = roundCents(input.total);
    if (!Number.isFinite(total) || total <= 0) return fail("Enter the price as a dollar amount above zero.");
    if (total > OWNER_JOB_LIMITS.maxTotal) return fail(`Prices over $${OWNER_JOB_LIMITS.maxTotal.toLocaleString("en-US")} need a different agreement.`);
    const travel = roundCents(Number.isFinite(input.travel) ? Math.max(0, input.travel) : 0);
    if (travel > total) return fail("Travel can't be more than the whole price.");
    const settings = await repo.getSettings();
    const previousTotal = job.total;
    job.scope = scope;
    job.description = input.description.trim() || scope;
    job.travelFee = travel;
    const priced = withDiscount(ownerPriceLines({ scope, total, travel }), job.discount);
    job.lines = priced.lines;
    job.total = priced.total;
    if (!job.scheduledDate) {
      if (input.hoursOnSite != null && Number.isFinite(input.hoursOnSite)) {
        if (input.hoursOnSite < OWNER_JOB_LIMITS.minHours || input.hoursOnSite > OWNER_JOB_LIMITS.maxHours) {
          return fail(`Hours on site must be between ${OWNER_JOB_LIMITS.minHours} and ${OWNER_JOB_LIMITS.maxHours}.`);
        }
        job.onsiteMinutes = Math.round(input.hoursOnSite * 60);
        job.params = { ...job.params, hours: input.hoursOnSite };
      }
      if (input.days != null && Number.isFinite(input.days)) {
        const days = Math.round(input.days);
        if (days < 1 || days > OWNER_JOB_LIMITS.maxDays) return fail(`Days must be between 1 and ${OWNER_JOB_LIMITS.maxDays}.`);
        job.durationDays = days;
      }
    }
    const problem = settleMoney(job, 0, settings.depositThreshold);
    if (problem) return fail(problem);
    if (invoice && job.workDoneOn) job.payRule = `Due in full. The work was done on ${longDate(job.workDoneOn)}.`;
    if (Math.abs(job.total - previousTotal) >= 0.01) priceChangeNote(job, previousTotal, "Price corrected by the owner");
    const saved = await repo.saveJob(job, { skipOverlap: true });
    return { ok: true, data: saved };
  });
}

/**
 * Owner only: cancel an invoice for finished work that was written up by mistake,
 * before anything is paid. Once money is in, a refund is the way to undo it.
 */
export async function voidInvoice(repo: Repository, actor: Actor, jobId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can void an invoice.");
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (!invoiceOnly(job)) return fail("Only an invoice for finished work can be voided. Cancel other jobs from the job page.");
    if (job.status !== "balance_due") return fail("This invoice is already settled or cancelled.");
    const payments = await repo.listPayments(job.id);
    if (amountPaid(payments, job.id) > 0) return fail("This invoice has a payment on it. Refund it instead of voiding it.");
    job.priorStatus = job.status;
    job.status = "cancelled";
    job.balanceDue = 0;
    job.amountDueNow = 0;
    const saved = await repo.saveJob(job, { skipOverlap: true });
    if (saved.docSentAt && saved.customerEmail.trim()) {
      const settings = await repo.getSettings();
      await mail(
        repo,
        saved.customerEmail,
        `Invoice #${saved.invoiceNumber} is cancelled: nothing is due`,
        `Hi ${saved.customerName}, we cancelled invoice #${saved.invoiceNumber} for ${saved.scope || "the work"}. Nothing is due on it. If we sent it by mistake, sorry for the confusion; a corrected invoice will come separately if one is needed.${emailFooter(settings)}`,
        saved.id,
      );
    }
    return { ok: true, data: saved };
  });
}
