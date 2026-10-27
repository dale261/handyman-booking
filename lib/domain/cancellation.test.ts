import { describe, expect, it } from "vitest";
import { applyRevisedTotal, linesForRevisedTotal, refundExceptTravel } from "./cancellation";
import { customerListPrice, LOCKED_PRICE, REVIEW_WAIT } from "./copy";
import { usd } from "@/lib/format";

describe("on-site money", () => {
  it("refunds everything except travel and does not add the cancel fee", () => {
    const same = refundExceptTravel(275, 50);
    expect(same.fee).toBe(50);
    expect(same.refund).toBe(225);
    expect(same.note).toMatch(/travel/i);
    expect(same.note).toMatch(/does not apply/i);

    const farther = refundExceptTravel(1000, 80);
    expect(farther.fee).toBe(80);
    expect(farther.refund).toBe(920);

    const short = refundExceptTravel(40, 50);
    expect(short.fee).toBe(40);
    expect(short.refund).toBe(0);
  });

  it("applies deposit rules to a revised total", () => {
    const higher = applyRevisedTotal({ paid: 275, newTotal: 400, threshold: 1500 });
    expect(higher.refund).toBe(0);
    expect(higher.amountDueNow).toBe(125);
    expect(higher.balanceDue).toBe(0);

    const lower = applyRevisedTotal({ paid: 275, newTotal: 200, threshold: 1500 });
    expect(lower.refund).toBe(75);
    expect(lower.amountDueNow).toBe(0);
    expect(lower.balanceDue).toBe(0);

    const deposit = applyRevisedTotal({ paid: 275, newTotal: 2000, threshold: 1500 });
    expect(deposit.amountDueNow).toBe(725);
    expect(deposit.balanceDue).toBe(1000);
    expect(deposit.refund).toBe(0);

    const alreadyHalf = applyRevisedTotal({ paid: 1000, newTotal: 1800, threshold: 1500 });
    expect(alreadyHalf.amountDueNow).toBe(0);
    expect(alreadyHalf.balanceDue).toBe(800);
    expect(alreadyHalf.refund).toBe(0);
  });

  it("adds one on-site line so the lines match the new total", () => {
    const lines = linesForRevisedTotal(
      [
        { label: "TV mount", detail: "", amount: 225, kind: "service" },
        { label: "Travel", detail: "", amount: 50, kind: "travel" },
      ],
      400,
    );
    expect(lines.find((line) => line.label === "On-site change")?.amount).toBe(125);
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(400);
  });
});

describe("customer price copy", () => {
  it("never offers a range to the customer", () => {
    expect(REVIEW_WAIT).not.toMatch(/\$/);
    expect(REVIEW_WAIT).toMatch(/firm price/i);
    expect(LOCKED_PRICE).toMatch(/won't change/i);
    expect(customerListPrice("scope_review", 482, usd)).toBe("Firm price after Dale reviews it");
    expect(customerListPrice("referred", 482, usd)).toBe("");
    expect(customerListPrice("quoted", 275, usd)).toBe("$275.00");
    expect(customerListPrice("scope_review", 482, usd)).not.toContain("482");
  });
});
