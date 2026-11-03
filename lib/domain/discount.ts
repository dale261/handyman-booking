import type { Discount } from "@/lib/db/types";
import { roundCents } from "./money";
import type { QuoteLine } from "./types";

/** Sum of every line that is not a discount: the price before any discount. */
export function grossTotal(lines: QuoteLine[]): number {
  return roundCents(lines.filter((line) => line.kind !== "discount").reduce((sum, line) => sum + line.amount, 0));
}

/**
 * The price lines with the owner's discount as the last line (negative), or with
 * any old discount line removed when there is no discount. A discount can't take
 * the price below zero.
 */
export function withDiscount(lines: QuoteLine[], discount: Discount | null | undefined): { lines: QuoteLine[]; total: number } {
  const kept = lines.filter((line) => line.kind !== "discount");
  const gross = grossTotal(kept);
  const amount = discount ? roundCents(Math.min(gross, Math.max(0, discount.amount))) : 0;
  if (amount <= 0) return { lines: kept, total: gross };
  return {
    lines: [...kept, { label: "Discount", detail: discount?.reason.trim() || "Discount", amount: -amount, kind: "discount" }],
    total: roundCents(gross - amount),
  };
}

/** The total a quoted number comes to after the discount, for places that only carry a total. */
export function discountedTotal(total: number, discount: Discount | null | undefined): number {
  if (!discount) return roundCents(total);
  return roundCents(Math.max(0, total - Math.max(0, discount.amount)));
}
