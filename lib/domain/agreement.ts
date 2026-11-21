import type { JobRecord, JobStatus, PaymentRecord } from "@/lib/db/types";
import { isLibraryQuote } from "@/lib/domain/library";
import { roundCents } from "@/lib/domain/money";
import { splitPayment } from "@/lib/domain/pricing";
import type { QuoteLine, Settings } from "@/lib/domain/types";
import { usd } from "@/lib/format";

export type TermSection = { title: string; body: string[] };

/** The price is firm and nothing has ended the job, so the customer can sign. */
export function canSign(status: JobStatus): boolean {
  return !["scope_review", "referred", "declined", "cancelled", "cancel_requested"].includes(status);
}

/**
 * Work that was finished before it was written up. The job skips scheduling and the
 * customer gets an invoice to pay rather than an agreement to sign.
 */
export function invoiceOnly(job: Pick<JobRecord, "workDoneOn" | "scheduledDate">): boolean {
  return Boolean(job.workDoneOn) && !job.scheduledDate;
}

/** "Saturday, November 7, 2026" for a calendar date like 2026-11-07. */
export function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** True once the customer has agreed to the price in some way: a signature or money paid. */
export function accepted(job: Pick<JobRecord, "agreement">, payments: PaymentRecord[]): boolean {
  if (job.agreement) return true;
  return payments.some((payment) => payment.kind !== "refund" && payment.status === "paid" && !payment.closed);
}

/**
 * Lines for a price the owner typed. The job is one line; travel is its own line
 * only when the owner split it out, so the cancel-on-site rule (refund all but travel)
 * still has a number to work with.
 */
export function ownerPriceLines(input: { scope: string; total: number; travel: number }): QuoteLine[] {
  const total = roundCents(Math.max(0, input.total));
  const travel = roundCents(Math.min(total, Math.max(0, input.travel)));
  const work = roundCents(total - travel);
  const lines: QuoteLine[] = [
    { label: input.scope.trim() || "The job", detail: "Firm price for the work described", amount: work, kind: "service" },
  ];
  if (travel > 0) lines.push({ label: "Travel", detail: "Included in the agreed price", amount: travel, kind: "travel" });
  return lines;
}

export type InvoiceSummary = {
  total: number;
  /** Money in that still counts (refunds taken off, closed payments ignored). */
  paid: number;
  refunded: number;
  /** What the customer still owes on the whole job. */
  balance: number;
  /** What the app is asking for right now, if anything. */
  dueNow: number;
  dueLabel: string;
};

export function invoiceSummary(
  job: Pick<JobRecord, "status" | "total" | "amountDueNow" | "balanceDue"> & Partial<Pick<JobRecord, "workDoneOn" | "scheduledDate">>,
  payments: PaymentRecord[],
): InvoiceSummary {
  const open = payments.filter((payment) => !payment.closed);
  const paidIn = open.filter((payment) => payment.kind !== "refund" && payment.status === "paid").reduce((sum, payment) => sum + payment.amount, 0);
  const refunded = open.filter((payment) => payment.kind === "refund").reduce((sum, payment) => sum + payment.amount, 0);
  const paid = roundCents(Math.max(0, paidIn - refunded));
  const total = roundCents(Math.max(0, job.total));
  const balance = roundCents(Math.max(0, total - paid));
  let dueNow = 0;
  let dueLabel = "Nothing is due right now.";
  if (job.status === "cancelled" || job.status === "declined" || job.status === "referred") {
    dueLabel = job.status === "cancelled" ? "This job was cancelled." : "This job was not booked.";
  } else if (job.status === "held" || (job.status === "booked" && job.amountDueNow > 0)) {
    dueNow = roundCents(Math.max(0, job.amountDueNow));
    dueLabel = job.status === "held" ? `${usd(dueNow)} is due now to confirm the booking.` : `${usd(dueNow)} is due now for the new price.`;
  } else if (job.status === "balance_due") {
    dueNow = roundCents(Math.max(0, job.balanceDue));
    dueLabel = invoiceOnly({ workDoneOn: job.workDoneOn ?? null, scheduledDate: job.scheduledDate ?? null })
      ? `${usd(dueNow)} is due now for the finished work.`
      : `${usd(dueNow)} balance is due now. The work is finished.`;
  } else if (job.status === "quoted" || job.status === "released") {
    if (job.amountDueNow > 0) {
      dueNow = roundCents(Math.max(0, job.amountDueNow));
      dueLabel = `${usd(dueNow)} is due to book. Pay now and pick a time later, or pick a time first.`;
    } else if (paid > 0) {
      dueLabel = balance > 0 ? `Paid ${usd(paid)}. Pick a time when you're ready; ${usd(balance)} is due when the work is finished.` : "Paid in full. Pick a time when you're ready.";
    } else {
      dueLabel = "Nothing is due until a time is booked.";
    }
  } else if (job.status === "pending_area") {
    dueLabel = "Nothing is due until we approve the address and a time is booked.";
  } else if (balance === 0 && total > 0) {
    dueLabel = "Paid in full. Thank you.";
  } else if (balance > 0) {
    dueLabel = `${usd(balance)} is still due when the work is finished.`;
  }
  return { total, paid, refunded: roundCents(refunded), balance, dueNow, dueLabel };
}

/**
 * Whether Michigan's $600 builder-license rule reaches this job. The listed services
 * (painting, cleaning, mounting, assembly, yard work, drain clearing, a helper) are not
 * builder work at any price. Unlisted work is builder work when the cost library says so.
 * When the app can't tell, it stays cautious and says yes, unless the owner marked the
 * job as not builder work (a store or commercial job, say).
 */
export function builderRuleApplies(job: Pick<JobRecord, "service" | "quoteMeta" | "licenseTrade" | "notBuilderWork">): boolean {
  if (job.notBuilderWork) return false;
  // Older saved jobs may be missing a field, so read them defensively.
  if ((job.licenseTrade ?? "").startsWith("Residential")) return true;
  if (isLibraryQuote(job.quoteMeta)) {
    const items = job.quoteMeta.items ?? [];
    return job.quoteMeta.kind === "hourly_fallback" || items.length === 0 || items.some((item) => item.group === "build");
  }
  return job.service === "other";
}

/**
 * Michigan's licensing statement, worded for the license we actually hold.
 * Not legal advice: the owner should have a lawyer look at the whole agreement once.
 */
export function licensingStatement(
  settings: Pick<Settings, "licenseNumber" | "businessName" | "builderThreshold">,
  total: number,
  /** The work is already done, so the "before work starts" wording doesn't fit. */
  done = false,
  /** Drain clearing gets its own trades sentence: clearing a clog is the job, plumbing repairs are not. */
  service?: string,
  /** False when the builder rule doesn't reach this kind of work. Left out, the statement stays cautious. */
  builderWork = true,
): string[] {
  const threshold = `$${Math.round(settings.builderThreshold).toLocaleString("en-US")}`;
  const rule = `Michigan requires a residential builder or a residential maintenance and alteration contractor to be licensed for residential work of ${threshold} or more, labor and materials included.`;
  const trades =
    service === "drain"
      ? "This job is drain clearing: we clear the clog with a drain snake and make no changes to the plumbing. Plumbing repairs or changes, electrical, and heating or cooling work must be done by contractors licensed for those trades and are not part of this agreement."
      : "Electrical, plumbing, and heating or cooling work must be done by contractors licensed for those trades. It is not part of this agreement unless it is listed above and a licensed trade contractor is named for it.";
  if (settings.licenseNumber) return [`${rule} ${settings.businessName} holds Michigan license number ${settings.licenseNumber}.`, trades];
  if (total < settings.builderThreshold) return [`${rule} This job is under that amount, so no builder license is required for it.`, trades];
  // Owner's call (Nov 21, 2026): a larger drain clearing job says nothing about a builder license. It's irrelevant to clearing a clog.
  if (service === "drain") return [trades];
  // Some jobs are over the amount and still fine to do: the rule only reaches builder work.
  if (!builderWork) return [`${rule} That rule does not apply to this kind of work, so no builder license is required for it.`, trades];
  return [
    `${rule} This job is at or over that amount, so a licensed contractor does the licensed part of the work.${done ? " We name that contractor and their license number on request." : " We confirm that contractor and their license number with you before work starts."}`,
    trades,
  ];
}

/** White-label job: the crew works under the customer's name and photos are never posted. */
export function isWhiteLabel(job: Pick<JobRecord, "whiteLabel">): boolean {
  return Boolean(job.whiteLabel);
}

/** The line a normal agreement carries about photos. A white-label job gets its own section instead. */
export const PHOTO_LINE =
  "We take photos of the work before, during, and after. We may post them on our website and social media, never showing faces, addresses, or your name. If you don't want yours posted, tell us before the job starts.";

/** The white-label section of an agreement, or of an invoice for work already done. */
export function whiteLabelTerms(done = false): TermSection {
  return {
    title: "White-label service",
    body: [
      done
        ? "This was a white-label job. On site, we worked as your company's technician, without our own name or branding."
        : "This is a white-label job. On site, we work as your company's technician, without our own name or branding.",
      "Photos of the work are for our records and your reports only. We never post them.",
    ],
  };
}

/**
 * The terms for an invoice on finished work: no scheduling, holds, or cancellation rules,
 * because none of that applies once the work is done. Paying is the acceptance.
 */
export function invoiceTerms(job: JobRecord, settings: Settings): TermSection[] {
  const done = job.workDoneOn ? ` on ${longDate(job.workDoneOn)}` : "";
  const sections: TermSection[] = [
    {
      title: "The price",
      body: [
        `The price covers the work listed above, which was done${done}. Travel is included.`,
        "Anything not listed, including materials, is not included.",
      ],
    },
    {
      title: "Payment",
      body: [
        "The full amount is due now.",
        `Pay online from this page (PayPal), or by check payable to ${settings.businessName}, or cash. Checks and cash count once we receive them, and this page then shows the payment.`,
      ],
    },
    {
      title: "If something isn't right",
      body: ["If anything about the work doesn't seem right, just let us know and we'll come back until the job is done properly."],
    },
    isWhiteLabel(job)
      ? whiteLabelTerms(true)
      : {
          title: "Photos",
          body: ["We may post photos of this work on our website and social media, never showing faces, addresses, or your name. If you'd rather we didn't, tell us."],
        },
  ];
  if (settings.warrantyText) sections.push({ title: "Our workmanship promise", body: [settings.warrantyText] });
  sections.push({ title: "Michigan licensing statement", body: licensingStatement(settings, job.total, true, job.service, builderRuleApplies(job)) });
  if (settings.extraTerms) sections.push({ title: "Other terms", body: settings.extraTerms.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean) });
  sections.push({
    title: "Paying this invoice",
    body: [
      "Paying this invoice, online or by cash or check, confirms the work listed above was done and accepts the price. We record when and how it was paid, and you can print or save a copy from this page any time.",
    ],
  });
  return sections;
}

/** The agreement terms, built from the rules the app actually enforces. */
export function agreementTerms(job: JobRecord, settings: Settings): TermSection[] {
  const declineRefund =
    job.travelFee > 0
      ? `If you decline, we cancel the job and refund everything you paid except ${usd(job.travelFee)} for travel.`
      : "If you decline, we cancel the job and refund everything you paid.";
  const split = splitPayment(job.total, settings.depositThreshold);
  const payLines =
    split.later > 0
      ? [`This job is half down to book: ${usd(split.now)} to book and ${usd(split.later)} when the work is finished.`]
      : [`This job is paid in full to book: ${usd(split.now)}.`];
  const sections: TermSection[] = [
    {
      title: "The price",
      body: [
        "This is your firm price for the work listed above.",
        "Anything not listed, including materials, costs extra. We give you a price before doing it.",
        job.ownerPriced ? "Travel is included." : "Travel is its own line, measured from where the crew is coming from.",
      ],
    },
    {
      title: "Changes on site",
      body: [
        "If the job isn't what was described, we stop and give you a new price. You approve or decline it on your job page. Nothing different gets done without your OK.",
        declineRefund,
      ],
    },
    {
      title: "Booking and payment",
      body: [
        ...payLines,
        `We hold your time for ${settings.holdHours} hours. Your payment confirms the booking. If it doesn't arrive in that time, we release the time.`,
        "Pay online from your job page (PayPal), or by cash or check. Cash and checks count once we receive them.",
      ],
    },
    {
      title: "Cancelling or rescheduling",
      body: [
        `Before work starts, you can cancel or reschedule from your job page. Either way, we keep ${usd(settings.cancelFee)} and refund the rest. If you paid ${usd(settings.cancelFee)} or less, there's no refund.`,
        "After work starts, cancelling needs our OK, and the refund depends on the work already done.",
        "If we can't do the job, or can't find someone who can, you get a full refund.",
      ],
    },
    {
      title: "Finishing the job",
      body: [
        "When we're done, look the work over. If anything doesn't seem right, just let us know and we'll come back until the job is done properly.",
        "Any balance is due when the work is finished.",
        ...(isWhiteLabel(job) ? [] : [PHOTO_LINE]),
      ],
    },
    {
      title: "Your part",
      body: [
        "Have the work area clear and reachable at the scheduled time, with pets secured and power and water on if the job needs them.",
        "Tell us before we arrive about anything unusual: alarms, gates, parking, fragile items.",
      ],
    },
  ];
  // A white-label job says so right after the price, where a store customer will look for it.
  if (isWhiteLabel(job)) sections.splice(1, 0, whiteLabelTerms());
  if (settings.warrantyText) sections.push({ title: "Our workmanship promise", body: [settings.warrantyText] });
  sections.push({ title: "Michigan licensing statement", body: licensingStatement(settings, job.total, false, job.service, builderRuleApplies(job)) });
  if (settings.extraTerms) sections.push({ title: "Other terms", body: settings.extraTerms.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean) });
  sections.push({
    title: "Agreeing to this",
    body: [
      "Typing your name on this page, or paying to book through our site, accepts this agreement. We record when and how, and you can print or save a copy from this page any time.",
      "This agreement, the price above, and any price change you approve on your job page are the whole agreement for this job.",
    ],
  });
  return sections;
}
