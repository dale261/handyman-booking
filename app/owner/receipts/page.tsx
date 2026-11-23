import Link from "next/link";
import { CrewLogSetupNote, ReceiptRow } from "@/components/crew-log";
import { Flash } from "@/components/flash";
import { ReceiptForm } from "@/components/receipt-form";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import type { ExpenseEntry } from "@/lib/db/types";
import { EXPENSE_LIMITS, owedByWorker, totalOwed } from "@/lib/domain/expenses";
import { addDays, canLogHours } from "@/lib/domain/hours";
import { jobChoice, recentJobs } from "@/lib/domain/job-pick";
import { todayDetroit, usd } from "@/lib/format";

/** How many paid-back receipts stay on the page. Older ones are still in the record. */
const PAID_SHOWN = 20;

/**
 * Receipts the crew turned in for things they paid for. This page keeps the list and
 * what is still owed. Paying someone back happens outside the app; the owner marks it here.
 */
export default async function OwnerReceiptsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const today = todayDetroit();
  const repo = getRepository();
  const logReady = await repo.crewLogReady();
  const receipts = (await repo.listCrewEntries()).filter((entry): entry is ExpenseEntry => entry.kind === "expense");
  const waiting = receipts.filter((entry) => !entry.reimbursedAt);
  const paid = receipts
    .filter((entry) => entry.reimbursedAt)
    .sort((a, b) => (b.reimbursedAt ?? "").localeCompare(a.reimbursedAt ?? ""))
    .slice(0, PAID_SHOWN);
  const people = owedByWorker(receipts);
  const workers = (await repo.listWorkers()).filter((worker) => worker.active).map((worker) => ({ id: worker.id, fullName: worker.fullName }));
  // Jobs a receipt can be tied to: the same list the crew picks from. Today's job first, nothing older than two months.
  const jobs = recentJobs((await repo.listJobs()).filter(canLogHours), today, EXPENSE_LIMITS.daysBack).map(jobChoice);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Receipts</h1>
        <p className="text-sm text-muted">Things the crew paid for that you pay back. Pay them the way you usually do, then mark it here.</p>
      </div>
      <Flash notice={query.notice} error={query.error} />
      {!logReady && <CrewLogSetupNote owner />}
      <Card>
        <CardContent className="space-y-2 text-sm">
          <p className="font-display text-xl font-semibold">You owe {usd(totalOwed(receipts))}</p>
          {people.length === 0 ? (
            <p className="text-muted">Nothing is waiting to be paid back.</p>
          ) : (
            <ul className="space-y-1">
              {people.map((person) => (
                <li key={person.workerId} className="flex flex-wrap justify-between gap-2">
                  <span className="font-semibold">{person.workerName}</span>
                  <span>
                    {usd(person.owed)} · {person.count} {person.count === 1 ? "receipt" : "receipts"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {waiting.length > 0 && (
        <Card>
          <CardContent className="space-y-3 text-sm">
            <p className="font-display text-xl font-semibold">Waiting to be paid back</p>
            <ul className="space-y-1.5">
              {waiting.map((entry) => (
                <ReceiptRow key={entry.id} entry={entry} owner back="/owner/receipts" />
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {paid.length > 0 && (
        <Card>
          <CardContent className="space-y-3 text-sm">
            <p className="font-display text-xl font-semibold">Paid back</p>
            <ul className="space-y-1.5">
              {paid.map((entry) => (
                <ReceiptRow key={entry.id} entry={entry} owner back="/owner/receipts" />
              ))}
            </ul>
            <p className="text-muted">The last {PAID_SHOWN} are shown.</p>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-display text-xl font-semibold">Add a receipt for someone</p>
            <p className="text-muted">For a paper receipt a crew member handed you.</p>
          </div>
          {logReady ? (
            <ReceiptForm today={today} minDate={addDays(today, -EXPENSE_LIMITS.daysBack)} back="/owner/receipts" workers={workers} jobs={jobs} />
          ) : (
            <CrewLogSetupNote owner />
          )}
        </CardContent>
      </Card>
      <p className="text-sm">
        <Link className="font-semibold text-pine underline" href="/owner/hours">
          Crew hours
        </Link>
      </p>
    </div>
  );
}
