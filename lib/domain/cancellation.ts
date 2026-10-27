import { num, roundCents } from "./money";
import { splitPayment } from "./pricing";
import type { QuoteLine } from "./types";

export type RefundQuote = {
  paid: number;
  fee: number;
  refund: number;
  note: string;
};

/**
 * Before work starts the customer (or the owner) can cancel or reschedule.
 * Keep the processing fee, refund the rest. If the fee or less was paid, the refund is $0.
 */
export function refundBeforeWork(paid: number, cancelFee: number): RefundQuote {
  const p = roundCents(Math.max(0, num(paid, 0)));
  const feeCap = roundCents(Math.max(0, num(cancelFee, 0)));
  const fee = roundCents(Math.min(feeCap, p));
  const refund = roundCents(p - fee);
  const note =
    p <= feeCap
      ? `You paid $${feeCap} or less, so we keep it and the refund is $0`
      : `We keep $${feeCap}. The rest will be refunded through PayPal`;
  return { paid: p, fee, refund, note };
}

export type OwnerRefundCheck =
  | { ok: true; refund: number; kept: number }
  | { ok: false; error: string };

/**
 * Cancel on site, or the customer declines a price change.
 * Keep the travel charge already on the job. Do not also keep the usual cancel fee.
 */
export function refundExceptTravel(paid: number, travelFee: number): RefundQuote {
  const p = roundCents(Math.max(0, num(paid, 0)));
  const travel = roundCents(Math.max(0, num(travelFee, 0)));
  const kept = roundCents(Math.min(travel, p));
  const refund = roundCents(p - kept);
  const note =
    refund > 0
      ? `We keep the travel charge ($${kept.toFixed(2)}) and refund the rest. The usual cancellation fee does not apply.`
      : "The travel charge covers what was paid, so the refund is $0. The usual cancellation fee does not apply.";
  return { paid: p, fee: kept, refund, note };
}

export type RevisedTotal = {
  newTotal: number;
  paid: number;
  amountDueNow: number;
  balanceDue: number;
  refund: number;
  payRule: string;
};

/**
 * A new on-site total, after money already collected.
 * Deposit rules apply to the new total. Anything already paid counts toward it.
 * If they paid more than the new total, the difference is a refund and nothing else is due.
 */
export function applyRevisedTotal(input: { paid: number; newTotal: number; threshold: number }): RevisedTotal {
  const paid = roundCents(Math.max(0, num(input.paid, 0)));
  const newTotal = roundCents(Math.max(0, num(input.newTotal, 0)));
  const split = splitPayment(newTotal, input.threshold);
  if (paid > newTotal) {
    return {
      newTotal,
      paid,
      amountDueNow: 0,
      balanceDue: 0,
      refund: roundCents(paid - newTotal),
      payRule: split.rule,
    };
  }
  const amountDueNow = roundCents(Math.max(0, split.now - paid));
  const balanceDue = roundCents(Math.max(0, newTotal - paid - amountDueNow));
  return { newTotal, paid, amountDueNow, balanceDue, refund: 0, payRule: split.rule };
}

/** Keep the original lines and add one adjustment so the lines add up to the new total. */
export function linesForRevisedTotal(lines: QuoteLine[], newTotal: number): QuoteLine[] {
  const kept = lines.filter((line) => line.label !== "On-site change");
  const base = roundCents(kept.reduce((sum, line) => sum + line.amount, 0));
  const delta = roundCents(roundCents(newTotal) - base);
  if (delta === 0) return kept;
  return [
    ...kept,
    {
      label: "On-site change",
      detail: "Difference from what you described",
      amount: delta,
      kind: "service",
    },
  ];
}

/**
 * After work has begun the owner types the refund. There is no suggested amount.
 * Empty is invalid. The amount must be from $0 through the amount paid.
 */
export function validateOwnerRefund(raw: string, paid: number): OwnerRefundCheck {
  const paidSafe = roundCents(Math.max(0, num(paid, 0)));
  if (raw.trim() === "") {
    return { ok: false, error: "Enter the refund amount. It can be $0." };
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || roundCents(n) > paidSafe) {
    return { ok: false, error: `Enter a number from $0 to $${paidSafe.toFixed(2)} (the amount paid).` };
  }
  const refund = roundCents(n);
  return { ok: true, refund, kept: roundCents(paidSafe - refund) };
}
