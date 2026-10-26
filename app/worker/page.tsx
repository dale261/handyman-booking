import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { formatDate, formatMinutes, todayDetroit } from "@/lib/format";
import { STATUS_LABEL, statusTone } from "@/lib/labels";
import { blocksSchedule } from "@/lib/domain/scheduling";

export default async function WorkerPage() {
  const actor = await requireActor();
  if (actor.role === "customer") {
    return <p>This page is for the crew. <Link className="font-semibold text-pine underline" href="/jobs">Your jobs</Link></p>;
  }
  const repo = getRepository();
  const workers = await repo.listWorkers();
  const me = workers.find((worker) => worker.id === actor.workerId);
  const jobs = (await repo.listJobs())
    .filter((job) => {
      if (actor.role === "owner") return blocksSchedule(job.status) && job.scheduledDate;
      if (!me) return false;
      return (job.workerIds.includes(me.id) || (me.crewId && job.crewId === me.crewId)) && blocksSchedule(job.status);
    })
    .sort((a, b) => `${a.scheduledDate} ${a.startMin}`.localeCompare(`${b.scheduledDate} ${b.startMin}`));
  const today = todayDetroit();

  return (
    <div className="space-y-4">
      <h1 className="font-display text-3xl font-semibold text-pine">{me ? me.fullName : "Crew work"}</h1>
      <p className="text-sm text-muted">Today in Cadillac is {formatDate(today)}. Open a job to start it or mark it done.</p>
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
                      {job.scheduledDate ? formatDate(job.scheduledDate) : "Unscheduled"} {job.startMin != null ? `at ${formatMinutes(job.startMin)}` : ""} · {job.jobSiteAddress}
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
