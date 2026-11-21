import type { JobRecord, PaymentRecord } from "@/lib/db/types";
import { agreementTerms, invoiceOnly, invoiceTerms, isWhiteLabel, longDate, whiteLabelTerms, type TermSection } from "@/lib/domain/agreement";
import { LOCKED_PRICE } from "@/lib/domain/copy";
import { splitPayment } from "@/lib/domain/pricing";
import type { Settings } from "@/lib/domain/types";
import { usd } from "@/lib/format";

/**
 * A customer keeps the wording they agreed to. The terms were reworded on the date
 * below: shorter sentences, work photos may be posted by default, white-label jobs,
 * and any balance due when the work is finished instead of after approval.
 *
 * A job accepted (signed, or first paid) before that moment keeps printing the
 * wording that was live when the customer accepted it. Everything else, including
 * a price that hasn't been accepted yet, prints the current wording.
 *
 * SET THIS TO THE MOMENT THE NEW WORDING GOES LIVE. When the terms are reworded
 * again, add another date and another "before" pair below; never edit an old pair.
 */
export const NEW_TERMS_FROM = "2026-11-22T00:00:00.000Z";

/** When the customer agreed: their signature, or the first payment they made. Null if neither yet. */
export function acceptedAt(job: Pick<JobRecord, "agreement">, payments: PaymentRecord[]): string | null {
  const times = payments.filter((payment) => payment.kind !== "refund" && payment.status === "paid").map((payment) => payment.createdAt);
  if (job.agreement?.signedAt) times.push(job.agreement.signedAt);
  return times.length > 0 ? times.sort()[0] : null;
}

/** True when the customer accepted before the terms were reworded, so the earlier wording still governs. */
export function keepsEarlierTerms(job: Pick<JobRecord, "agreement">, payments: PaymentRecord[]): boolean {
  const when = acceptedAt(job, payments);
  return when !== null && when < NEW_TERMS_FROM;
}

/** The terms to print for a job: the wording the customer accepted, or today's if they haven't yet. */
export function documentTerms(job: JobRecord, payments: PaymentRecord[], settings: Settings): TermSection[] {
  const invoice = invoiceOnly(job);
  if (!keepsEarlierTerms(job, payments)) return invoice ? invoiceTerms(job, settings) : agreementTerms(job, settings);
  const sections = invoice ? invoiceTermsBefore(job, settings) : agreementTermsBefore(job, settings);
  // White-label only ever protects the customer more, so it shows on an earlier agreement too.
  if (isWhiteLabel(job)) sections.splice(1, 0, whiteLabelTerms(invoice));
  return sections;
}

// ---------------------------------------------------------------------------
// The wording that was live until NEW_TERMS_FROM. Copied as it stood; do not edit.
// ---------------------------------------------------------------------------

function invoiceTermsBefore(job: JobRecord, settings: Settings): TermSection[] {
  const done = job.workDoneOn ? ` on ${longDate(job.workDoneOn)}` : "";
  const sections: TermSection[] = [
    {
      title: "The price",
      body: [
        `The price covers the work listed above, which was done${done}. Travel is included.`,
        "Materials and anything else not listed are not included.",
      ],
    },
    {
      title: "Payment",
      body: [
        "The full amount is due now.",
        `You can pay online from this page (PayPal), or by check payable to ${settings.businessName}, or cash. We mark checks and cash paid when we receive them, and this page shows the payment once it's recorded.`,
      ],
    },
    {
      title: "If something isn't right",
      body: ["If anything about the work isn't right, tell us and we come back to make it right."],
    },
  ];
  if (settings.warrantyText) sections.push({ title: "Our workmanship promise", body: [settings.warrantyText] });
  sections.push({ title: "Michigan licensing statement", body: licensingStatementBefore(settings, job.total, true, job.service) });
  if (settings.extraTerms) sections.push({ title: "Other terms", body: settings.extraTerms.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean) });
  sections.push({
    title: "Paying this invoice",
    body: [
      "Paying this invoice, online or by cash or check, confirms that the work listed above was done and accepts the price. We keep a record of when and how it was paid, and you can print or save a copy any time from this page.",
    ],
  });
  return sections;
}

function agreementTermsBefore(job: JobRecord, settings: Settings): TermSection[] {
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
      : [`This job is paid in full to book: ${usd(split.now)}.`];
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
  sections.push({ title: "Michigan licensing statement", body: licensingStatementBefore(settings, job.total, false, job.service) });
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

/** The licensing statement as it read until NEW_TERMS_FROM. */
function licensingStatementBefore(
  settings: Pick<Settings, "licenseNumber" | "businessName" | "builderThreshold">,
  total: number,
  /** The work is already done, so the "before work starts" wording doesn't fit. */
  done = false,
  /** Drain clearing gets its own trades sentence: clearing a clog is the job, plumbing repairs are not. */
  service?: string,
): string[] {
  const threshold = `$${Math.round(settings.builderThreshold).toLocaleString("en-US")}`;
  const trades =
    service === "drain"
      ? "This job is drain clearing: we clear the clog with a drain snake and make no changes to the plumbing. Plumbing repairs or changes, electrical, and heating or cooling work must be done by contractors licensed for those trades and are not part of this agreement."
      : "Electrical, plumbing, and heating or cooling work must be done by contractors licensed for those trades. It is not part of this agreement unless it is listed above and a licensed trade contractor is named for it.";
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
  // Owner's call (Nov 21, 2026): a drain clearing job of the threshold or more leaves the builder sentence out.
  if (service === "drain") return [trades];
  return [
    `Michigan requires a residential builder or a residential maintenance and alteration contractor to be licensed for residential work of ${threshold} or more, labor and materials included. This job is at or over that amount, so a licensed contractor does the licensed part of the work.${done ? " We name that contractor and their license number on request." : " We confirm that contractor and their license number with you before work starts."}`,
    trades,
  ];
}
