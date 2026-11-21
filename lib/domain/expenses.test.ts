import { describe, expect, it } from "vitest";
import type { ExpenseEntry } from "@/lib/db/types";
import { checkExpense, owedByWorker, totalOwed } from "@/lib/domain/expenses";

const today = "2026-11-21";

function receipt(workerId: string, workerName: string, amount: number, reimbursedAt: string | null = null): ExpenseEntry {
  return { id: `${workerId}-${amount}`, kind: "expense", workerId, workerName, date: today, amount, what: "Supplies", jobId: null, jobScope: "", photoId: null, reimbursedAt, at: `${today}T15:00:00.000Z` };
}

describe("checking a receipt", () => {
  it("accepts a recent purchase and tidies it", () => {
    expect(checkExpense({ date: "2026-11-20", amount: 24.5, what: "  Caulk   and painter's tape " }, today)).toEqual({ ok: true, date: "2026-11-20", amount: 24.5, what: "Caulk and painter's tape" });
    expect(checkExpense({ date: today, amount: 10.999, what: "Gas" }, today)).toMatchObject({ ok: true, amount: 11 });
  });

  it("refuses the future, the distant past, bad amounts, and a blank description", () => {
    expect(checkExpense({ date: "2026-11-22", amount: 5, what: "Gas" }, today).ok).toBe(false);
    expect(checkExpense({ date: "2026-09-01", amount: 5, what: "Gas" }, today).ok).toBe(false);
    expect(checkExpense({ date: "not a day", amount: 5, what: "Gas" }, today).ok).toBe(false);
    expect(checkExpense({ date: today, amount: 0, what: "Gas" }, today).ok).toBe(false);
    expect(checkExpense({ date: today, amount: -4, what: "Gas" }, today).ok).toBe(false);
    expect(checkExpense({ date: today, amount: Number.NaN, what: "Gas" }, today).ok).toBe(false);
    expect(checkExpense({ date: today, amount: 5001, what: "Gas" }, today).ok).toBe(false);
    expect(checkExpense({ date: today, amount: 5, what: " " }, today).ok).toBe(false);
  });
});

describe("what is owed", () => {
  const receipts = [receipt("w1", "Alex", 24.5), receipt("w1", "Alex", 10.1), receipt("w2", "Sam", 80), receipt("w2", "Sam", 300, "2026-11-21T18:00:00.000Z")];

  it("adds up each person's unpaid receipts, largest first, and skips what was paid back", () => {
    expect(owedByWorker(receipts)).toEqual([
      { workerId: "w2", workerName: "Sam", owed: 80, count: 1 },
      { workerId: "w1", workerName: "Alex", owed: 34.6, count: 2 },
    ]);
    expect(totalOwed(receipts)).toBe(114.6);
  });

  it("is nothing when everything is paid back", () => {
    expect(owedByWorker([receipt("w2", "Sam", 300, "2026-11-21T18:00:00.000Z")])).toEqual([]);
    expect(totalOwed([])).toBe(0);
  });
});
