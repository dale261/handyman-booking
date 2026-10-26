import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { formatDate, formatMinutes, usd } from "@/lib/format";
import { STATUS_LABEL, statusTone } from "@/lib/labels";
import { SERVICE_LABELS } from "@/lib/domain/types";

export default async function JobsPage() {
  const actor = await requireActor();
  if (actor.role === "owner") {
    return (
      <p>
        Owners use the <Link className="font-semibold text-pine underline" href="/owner/jobs">full job list</Link>.
      </p>
    );
  }
  if (actor.role === "worker") {
    return (
      <p>
        Your work is on the <Link className="font-semibold text-pine underline" href="/worker">crew list</Link>.
      </p>
    );
  }
  const jobs = (await getRepository().listJobs()).filter((job) => job.customerId === actor.id).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold text-pine">Your jobs</h1>
        <Link href="/book" className="rounded-md bg-pine px-4 py-2 text-sm font-semibold text-paper">
          New quote
        </Link>
      </div>
      {jobs.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-muted">No jobs yet. Request a quote and we&apos;ll price it from the rate sheet.</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {jobs.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="block">
              <Card className="hover:border-pine/40">
                <CardContent className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{job.scope || SERVICE_LABELS[job.service]}</p>
                    <p className="text-sm text-muted">
                      {job.scheduledDate ? `${formatDate(job.scheduledDate)} at ${formatMinutes(job.startMin || 0)}` : job.jobSiteAddress}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {job.status !== "scope_review" && job.status !== "referred" && <span className="text-sm font-semibold">{usd(job.total)}</span>}
                    <Badge tone={statusTone(job.status)}>{STATUS_LABEL[job.status]}</Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
