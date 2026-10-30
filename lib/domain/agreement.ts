import type { JobRecord, JobStatus, PaymentRecord } from "@/lib/db/types";
import { LOCKED_PRICE } from "@/lib/domain/copy";
import { roundCents } from "@/lib/domain/money";
import { splitPayment } from "@/lib/domain/pricing";
import type { QuoteLine, Settings } from "@/lib/domain/types";
import { usd } from "@/lib/format";

export type TermSection = { title: string; body: string[] };

/** The price is firm and nothing has ended the job, so the customer can sign. */
export function canSign(status: JobStatus): boolean {
  return !["scope_review", "referred", "declined", "cancelled", "cancel_requested"].includes(status);
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

export function invoiceSummary(job: Pick<JobRecord, "status" | "total" | "amountDueNow" | "balanceDue">, payments: PaymentRecord[]): InvoiceSummary {
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
    dueLabel = `${usd(dueNow)} balance is due now. The work is done and approved.`;
  } else if (job.status === "quoted" || job.status === "released" || job.status === "pending_area") {
    dueLabel = "Nothing is due until a time is booked.";
  } else if (balance === 0 && total > 0) {
    dueLabel = "Paid in full. Thank you.";
  } else if (balance > 0) {
    dueLabel = `${usd(balance)} is still due after the work is done and you approve it.`;
  }
  return { total, paid, refunded: roundCents(refunded), balance, dueNow, dueLabel };
}

/**
 * Michigan's licensing statement, worded for the license we actually hold.
 * Not legal advice: the owner should have a lawyer look at the whole agreement once.
 */
export function licensingStatement(settings: Pick<Settings, "licenseNumber" | "businessName" | "builderThreshold">, total: number): string[] {
  const threshold = `$${Math.round(settings.builderThreshold).toLocaleString("en-US")}`;
  const trades =
    "Electrical, plumbing, and heating or cooling work must be done by contractors licensed for those trades. It is not part of this agreement unless it is listed above and a licensed trade contractor is named for it.";
  if (settings.licenseNumber) {
    return [
      `Michigan requires a residential builder or a residential maintenance and alteration contractor to be licensed for residential work of ${threshold} or more, labor and materials included. ${settings.businessName} holds Michigan license number ${settings.licenseNumber}.`,
      trades,
    ];
  }
  if (total < settings.builderThreshold) {
    return [
      `Michigan requires a residential builder or a residential maintenance and alteration contractor to be licensed for residential work of ${threshold} or more, labor and materials included. This job is under that amount, so no builder license is required for it.`,
      trades,
    ];
  }
  return [
    `Michigan requires a residential builder or a residential maintenance and alteration contractor to be licensed for residential work of ${threshold} or more, labor and materials included. This job is at or over that amount, so a licensed contractor does the licensed part of the work. We confirm that contractor and their license number with you before work starts.`,
    trades,
  ];
}

/** The agreement terms, built from the rules the app actually enforces. */
export function agreementTerms(job: JobRecord, settings: Settings): TermSection[] {
  const declineRefund =
    job.travelFee > 0
      ? `If you decline the new price, we cancel the job and refund everything you paid except ${usd(job.travelFee)} for travel.`
      : "If you decline the new price, we cancel the job and refund everything you paid.";
  const split = splitPayment(job.total, settings.depositThreshold);
  const payLines =
    split.later > 0
      ? [
          `Jobs of ${usd(settings.depositThreshold)} or more are half down to book. The rest is due after the work is done and you approve it.`,
          `For this job that is ${usd(split.now)} to book and ${usd(split.later)} after approval.`,
        ]
      : [`Jobs under ${usd(settings.depositThreshold)} are paid in full to book. For this job that is ${usd(split.now)}.`];
  const sections: TermSection[] = [
    {
      title: "The price",
      body: [
        LOCKED_PRICE,
        "The price covers the work and the items listed above. Materials and anything else not listed are not included; we quote them separately before doing them.",
        job.ownerPriced ? "Travel is included in this price." : "Travel is measured from where the crew is coming from and is shown as its own line.",
      ],
    },
    {
      title: "Changes on site",
      body: [
        "If the job turns out different from what was described, we stop and propose a new price before doing any different work. You approve or decline it in writing on your job page; nothing changes without your OK.",
        declineRefund,
      ],
    },
    {
      title: "Booking and payment",
      body: [
        ...payLines,
        `A time is held for ${settings.holdHours} hours while the payment to book comes in. The booking is confirmed when that payment is received. If it does not arrive, the time is released.`,
        "You can pay online through your job page (PayPal) or by cash or check; we mark cash and checks paid when we receive them.",
      ],
    },
    {
      title: "Cancelling or rescheduling",
      body: [
        `Before work starts, you can cancel or reschedule from your job page. We keep ${usd(settings.cancelFee)} and refund the rest of what you paid. If you paid ${usd(settings.cancelFee)} or less, there is nothing to refund.`,
        "After work has started, a cancellation needs our approval and we set the refund based on the work already done.",
        "If we cannot do the job, or cannot find someone who can, you get a full refund.",
      ],
    },
    {
      title: "Finishing the job",
      body: [
        "When the crew is done, we mark the job finished and you look it over. Approve it on your job page, or report a problem and we come back to make it right before you approve.",
        "Any balance is due after you approve the finished work.",
        "We may take before-and-after photos of the work for our records. We only show them publicly if you say so when you leave a review.",
      ],
    },
    {
      title: "Your part",
      body: [
        "Please have the work area reachable and cleared at the scheduled time, with pets secured and power and water on where the job needs them.",
        "Tell us about anything unusual at the site (alarms, gates, parking, fragile items) before the crew arrives.",
      ],
    },
  ];
  if (settings.warrantyText) sections.push({ title: "Our workmanship promise", body: [settings.warrantyText] });
  sections.push({ title: "Michigan licensing statement", body: licensingStatement(settings, job.total) });
  if (settings.extraTerms) sections.push({ title: "Other terms", body: settings.extraTerms.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean) });
  sections.push({
    title: "Agreeing to this",
    body: [
      "Typing your name on this page, or paying to book through our site, accepts this agreement. We keep a record of when and how it was accepted, and you can print or save a copy any time from this page.",
      "This agreement, the price above, and any price change you approve on your job page are the whole agreement for this job.",
    ],
  });
  return sections;
}
