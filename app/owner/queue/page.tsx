import Link from "next/link";
import { markNotesRead } from "@/lib/actions";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import type { JobRecord } from "@/lib/db/types";
import { usd } from "@/lib/format";
import { STATUS_LABEL, statusTone } from "@/lib/labels";

export default async function QueuePage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const repo = getRepository();
  const [jobs, notes, emails, payments] = await Promise.all([repo.listJobs(), repo.listNotifications(), repo.listEmails(), repo.listPayments()]);
  const unread = notes.filter((note) => !note.read);
  const refunds = payments.filter((payment) => payment.kind === "refund" && payment.status === "pending");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-semibold text-ink">Queue</h1>
        <form action={markNotesRead}>
          <SubmitButton variant="outline" size="sm">Mark notices read</SubmitButton>
        </form>
      </div>
      <Flash notice={query.notice} />
      <Section title="License review" jobs={jobs.filter((job) => job.status === "scope_review")} empty="Nothing is waiting on a license decision." />
      <Section title="Address review" jobs={jobs.filter((job) => job.status === "pending_area")} empty="No addresses are waiting on you." />
      <Section title="Cancellation requests" jobs={jobs.filter((job) => job.status === "cancel_requested")} empty="No cancellation is waiting on you." />
      <Section title="Problems" jobs={jobs.filter((job) => job.status === "disputed")} empty="No open problems." />
      <Section title="Finished, not approved yet" jobs={jobs.filter((job) => job.status === "awaiting_approval")} empty="Every finished job has been approved, or none are waiting." />

      <Card>
        <CardHeader>
          <CardTitle>Notices ({unread.length} unread)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {notes.length === 0 ? (
            <p className="text-muted">No notices yet. Payments, finished jobs, and cancellation requests show up here and in email.</p>
          ) : (
            notes.slice(0, 30).map((note) => (
              <div key={note.id} className="rounded-md border border-line px-3 py-2">
                <p className="font-semibold">{note.read ? note.title : `New · ${note.title}`}</p>
                <p className="text-muted">{note.detail}</p>
                {note.jobId && (
                  <Link className="font-semibold text-pine underline" href={`/jobs/${note.jobId}`}>
                    Open job
                  </Link>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Refunds to send</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {refunds.length === 0 ? (
            <p className="text-muted">No refund is waiting. PayPal refunds are sent by you, then marked sent on the job.</p>
          ) : (
            refunds.map((payment) => (
              <p key={payment.id}>
                {usd(payment.amount)} · {payment.note} · <Link className="font-semibold text-pine underline" href={`/jobs/${payment.jobId}`}>Open job</Link>
              </p>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Email log</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {emails.length === 0 ? (
            <p className="text-muted">No emails yet. Without a Resend key they still print in the terminal that is running the app.</p>
          ) : (
            emails.slice(0, 20).map((email) => (
              <div key={email.id} className="rounded-md border border-line px-3 py-2">
                <p className="font-semibold">{email.subject}</p>
                <p className="text-muted">To {email.to} · {email.sent ? "sent" : "logged"}</p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title, jobs, empty }: { title: string; jobs: JobRecord[]; empty: string }) {
  return (
    <section className="space-y-2">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="grid gap-2">
          {jobs.map((job) => (
            <Link key={job.id} href={`/jobs/${job.id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 py-2 text-sm">
              <span>
                <span className="font-semibold">{job.customerName}</span> · {job.scope || job.description}
                {job.quoteMeta && (job.status === "scope_review" || job.status === "referred")
                  ? ` · est. ${usd(job.quoteMeta.rangeLow)}–${usd(job.quoteMeta.rangeHigh)}`
                  : ""}
              </span>
              <Badge tone={statusTone(job.status)}>{STATUS_LABEL[job.status]}</Badge>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
