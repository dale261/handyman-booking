import Link from "next/link";
import { CrewLogSetupNote, ReceiptRow, ShopTimeForm } from "@/components/crew-log";
import { Flash } from "@/components/flash";
import { ReceiptForm } from "@/components/receipt-form";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { formatDate, formatDateRange, formatMinutes, todayDetroit, usd } from "@/lib/format";
import { STATUS_LABEL, statusTone } from "@/lib/labels";
import { removeCrewEntryAction } from "@/lib/actions";
import type { ExpenseEntry, ShopHoursEntry } from "@/lib/db/types";
import { EXPENSE_LIMITS, totalOwed } from "@/lib/domain/expenses";
import { addDays, entriesFor, HOURS_LIMITS, hoursLabel, totalHours, weekStart } from "@/lib/domain/hours";
import { blocksSchedule, jobDates } from "@/lib/domain/scheduling";

export default async function WorkerPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const actor = await requireActor();
  const query = await searchParams;
  if (actor.role === "customer") {
    return <p>This page is for the crew. <Link className="font-semibold text-pine underline" href="/jobs">Your jobs</Link></p>;
  }
  const repo = getRepository();
  const workers = await repo.listWorkers();
  const me = workers.find((worker) => worker.id === actor.workerId);
  const allJobs = await repo.listJobs();
  const jobs = allJobs
    .filter((job) => {
      if (actor.role === "owner") return blocksSchedule(job.status) && job.scheduledDate;
      if (!me) return false;
      return (job.workerIds.includes(me.id) || (me.crewId && job.crewId === me.crewId)) && blocksSchedule(job.status);
    })
    .sort((a, b) => `${a.scheduledDate} ${a.startMin}`.localeCompare(`${b.scheduledDate} ${b.startMin}`));
  const today = todayDetroit();
  // The crew member's own hours: this week and last, Monday through Sunday.
  const thisWeek = weekStart(today);
  const lastWeek = addDays(thisWeek, -7);
  // Shop time and receipts are this crew member's own. Nobody else's are loaded onto this page.
  const log = me ? (await repo.listCrewEntries()).filter((entry) => entry.workerId === me.id) : [];
  const logReady = me ? await repo.crewLogReady() : true;
  const shop = log.filter((entry): entry is ShopHoursEntry => entry.kind === "shop_hours");
  const receipts = log.filter((entry): entry is ExpenseEntry => entry.kind === "expense");
  // Every receipt still owed, then the ones paid back in the last two months.
  const shownReceipts = receipts.filter((entry) => !entry.reimbursedAt || entry.date >= addDays(today, -EXPENSE_LIMITS.daysBack));
  const owed = totalOwed(receipts);
  const mine = me ? entriesFor(allJobs, me.id, thisWeek, addDays(thisWeek, 6), shop) : [];
  const mineLastWeek = me ? entriesFor(allJobs, me.id, lastWeek, addDays(lastWeek, 6), shop) : [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold text-ink">{me ? me.fullName : "Crew work"}</h1>
      <p className="text-sm text-muted">Today in Cadillac is {formatDate(today)}. Open a job to start it, mark it done, or add your hours.</p>
      <Flash notice={query.notice} error={query.error} />
      {me && (
        <Card>
          <CardContent className="space-y-2 text-sm">
            <p className="font-display text-xl font-semibold">My hours</p>
            <p>
              This week: <span className="font-semibold">{hoursLabel(totalHours(mine))}</span> · Last week: <span className="font-semibold">{hoursLabel(totalHours(mineLastWeek))}</span>
            </p>
            {mine.length === 0 ? (
              <p className="text-muted">Nothing logged this week yet. For time on a job, open the job and use &quot;Add hours&quot;. For time that wasn&apos;t on a job, use shop time below.</p>
            ) : (
              <ul className="space-y-1">
                {mine.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {formatDate(entry.date)}: {hoursLabel(entry.hours)} ·{" "}
                      {entry.jobId ? (
                        <Link className="font-semibold text-pine underline" href={`/jobs/${entry.jobId}`}>
                          {entry.scope}
                        </Link>
                      ) : (
                        <span className="font-semibold">
                          {entry.scope}
                          {entry.note ? <span className="font-normal text-muted"> · {entry.note}</span> : null}
                        </span>
                      )}
                    </span>
                    {!entry.jobId && (
                      <form action={removeCrewEntryAction}>
                        <input type="hidden" name="back" value="/worker" />
                        <input type="hidden" name="entryId" value={entry.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Remove
                        </SubmitButton>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted">A week runs Monday through Sunday.</p>
            <div className="space-y-3 border-t border-line pt-3">
              <div>
                <p className="font-semibold">Add shop time</p>
                <p className="text-muted">For hours that weren&apos;t on a job: loading up, cleaning tools, a supply run.</p>
              </div>
              {logReady ? <ShopTimeForm today={today} minDate={addDays(today, -HOURS_LIMITS.daysBack)} back="/worker" /> : <CrewLogSetupNote owner={false} />}
            </div>
          </CardContent>
        </Card>
      )}
      {me && (
        <Card>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="font-display text-xl font-semibold">Receipts</p>
              <p className="text-muted">Paid for something for work? Add it here so you get paid back.</p>
            </div>
            {owed > 0 && (
              <p>
                You&apos;re owed: <span className="font-semibold">{usd(owed)}</span>
              </p>
            )}
            {shownReceipts.length > 0 && (
              <ul className="space-y-1.5">
                {shownReceipts.map((entry) => (
                  <ReceiptRow key={entry.id} entry={entry} owner={false} back="/worker" />
                ))}
              </ul>
            )}
            <div className="space-y-3 border-t border-line pt-3">
              <p className="font-semibold">Add a receipt</p>
              {logReady ? (
                <ReceiptForm
                  today={today}
                  minDate={addDays(today, -EXPENSE_LIMITS.daysBack)}
                  back="/worker"
                  jobs={jobs.map((job) => ({ id: job.id, scope: job.scope || "Job" }))}
                />
              ) : (
                <CrewLogSetupNote owner={false} />
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {jobs.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-muted">Nothing is on your crew right now.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {jobs.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`}>
              <Card>
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{job.scope}</p>
                    <p className="text-sm text-muted">
                      {job.scheduledDate ? formatDateRange(jobDates(job)) : "Unscheduled"} {job.startMin != null ? `at ${formatMinutes(job.startMin)}` : ""} · {job.jobSiteAddress}
                    </p>
                  </div>
                  <Badge tone={statusTone(job.status)}>{STATUS_LABEL[job.status]}</Badge>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
