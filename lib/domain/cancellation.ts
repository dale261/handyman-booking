import { num, roundCents } from "./money";

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
