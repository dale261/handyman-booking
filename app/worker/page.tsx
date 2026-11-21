import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { formatDate, formatDateRange, formatMinutes, todayDetroit } from "@/lib/format";
import { STATUS_LABEL, statusTone } from "@/lib/labels";
import { addDays, entriesFor, hoursLabel, totalHours, weekStart } from "@/lib/domain/hours";
import { blocksSchedule, jobDates } from "@/lib/domain/scheduling";

export default async function WorkerPage() {
  const actor = await requireActor();
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
  const mine = me ? entriesFor(allJobs, me.id, thisWeek, addDays(thisWeek, 6)) : [];
  const mineLastWeek = me ? entriesFor(allJobs, me.id, lastWeek, addDays(lastWeek, 6)) : [];

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold text-ink">{me ? me.fullName : "Crew work"}</h1>
      <p className="text-sm text-muted">Today in Cadillac is {formatDate(today)}. Open a job to start it, mark it done, or add your hours.</p>
      {me && (
        <Card>
          <CardContent className="space-y-2 text-sm">
            <p className="font-display text-xl font-semibold">My hours</p>
            <p>
              This week: <span className="font-semibold">{hoursLabel(totalHours(mine))}</span> · Last week: <span className="font-semibold">{hoursLabel(totalHours(mineLastWeek))}</span>
            </p>
            {mine.length === 0 ? (
              <p className="text-muted">Nothing logged this week yet. Open a job and use &quot;Add hours&quot;.</p>
            ) : (
              <ul className="space-y-1">
                {mine.map((entry) => (
                  <li key={entry.id}>
                    {formatDate(entry.date)}: {hoursLabel(entry.hours)} ·{" "}
                    <Link className="font-semibold text-pine underline" href={`/jobs/${entry.jobId}`}>
                      {entry.scope}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-muted">A week runs Monday through Sunday.</p>
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
