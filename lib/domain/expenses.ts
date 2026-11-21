import type { ExpenseEntry } from "@/lib/db/types";
import { addDays, isDate } from "@/lib/domain/hours";
import { roundCents } from "@/lib/domain/money";

/** Receipts a crew member turns in for money they spent on the business. */
export const EXPENSE_LIMITS = { min: 0.01, max: 5000, daysBack: 60, whatMin: 2, whatMax: 200 };

export type ExpenseCheck = { ok: true; date: string; amount: number; what: string } | { ok: false; error: string };

/** A real purchase: a recent day, a sensible amount, and a few words on what it was. */
export function checkExpense(input: { date: string; amount: number; what: string }, today: string): ExpenseCheck {
  const date = input.date.trim();
  if (!isDate(date)) return { ok: false, error: "Pick the day you bought it." };
  if (date > today) return { ok: false, error: "That day hasn't happened yet." };
  if (date < addDays(today, -EXPENSE_LIMITS.daysBack)) return { ok: false, error: `Receipts can be added up to ${EXPENSE_LIMITS.daysBack} days back. For anything older, ask the owner.` };
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount < EXPENSE_LIMITS.min) return { ok: false, error: "Enter what you paid, such as 24.50." };
  if (amount > EXPENSE_LIMITS.max) return { ok: false, error: `That's over $${EXPENSE_LIMITS.max.toLocaleString("en-US")}. Check the amount, or ask the owner to enter it.` };
  const what = input.what.replace(/\s+/g, " ").trim();
  if (what.length < EXPENSE_LIMITS.whatMin) return { ok: false, error: "Say what it was, such as 'Caulk and painter's tape'." };
  return { ok: true, date, amount: roundCents(amount), what: what.slice(0, EXPENSE_LIMITS.whatMax) };
}

export type Owed = { workerId: string; workerName: string; owed: number; count: number };

/** What the owner still owes each crew member, largest first. */
export function owedByWorker(entries: ExpenseEntry[]): Owed[] {
  const people = new Map<string, Owed>();
  for (const entry of entries) {
    if (entry.reimbursedAt) continue;
    const person = people.get(entry.workerId) ?? { workerId: entry.workerId, workerName: entry.workerName, owed: 0, count: 0 };
    person.owed = roundCents(person.owed + entry.amount);
    person.count += 1;
    people.set(entry.workerId, person);
  }
  return [...people.values()].sort((a, b) => b.owed - a.owed || a.workerName.localeCompare(b.workerName));
}

export function totalOwed(entries: ExpenseEntry[]): number {
  return roundCents(entries.filter((entry) => !entry.reimbursedAt).reduce((sum, entry) => sum + entry.amount, 0));
}
