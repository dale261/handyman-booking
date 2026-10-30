import Link from "next/link";
import { notFound } from "next/navigation";
import { sendAgreementAction } from "@/lib/actions";
import { AgreementDocument } from "@/components/agreement-document";
import { CopyField } from "@/components/copy-field";
import { Flash } from "@/components/flash";
import { PrintButton } from "@/components/print-button";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import type { JobRecord } from "@/lib/db/types";
import { canSign } from "@/lib/domain/agreement";
import type { Settings } from "@/lib/domain/types";
import { contractUrl } from "@/lib/format";
import { ensureDocToken } from "@/lib/services/agreement";
import { visibleTo } from "@/lib/services/booking";

export default async function ContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await requireActor();
  const repo = getRepository();
  let job = await repo.getJob(id);
  if (!job || !(await visibleTo(repo, actor, job))) notFound();
  if (actor.role === "owner") job = await ensureDocToken(repo, job);
  const [payments, crews, settings] = await Promise.all([repo.listPayments(job.id), repo.listCrews(), repo.getSettings()]);
  const crewName = crews.find((crew) => crew.id === job.crewId)?.name;

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link className="text-sm font-semibold text-pine underline" href={`/jobs/${job.id}`}>
            Back to the job
          </Link>
          <h1 className="font-display text-3xl font-semibold text-ink">Contract and invoice</h1>
          <p className="text-sm text-muted">Everything here comes from the job record. Print it or save it as a PDF from your phone or computer.</p>
        </div>
        <PrintButton />
      </div>
      <div className="no-print">
        <Flash notice={query.notice} error={query.error} />
      </div>
      {actor.role === "owner" && <OwnerDocTools job={job} settings={settings} />}
      <AgreementDocument job={job} payments={payments} settings={settings} crewName={crewName} viewer={actor.role} />
    </div>
  );
}

function OwnerDocTools({ job, settings }: { job: JobRecord; settings: Settings }) {
  const sendable = canSign(job.status) && Boolean(job.customerEmail.trim());
  const missing = !settings.businessPhone && !settings.businessEmail;
  return (
    <Card className="no-print">
      <CardHeader>
        <CardTitle>Send it to the customer</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-muted">
          The link opens without a sign-in. It shows this agreement and invoice, a sign-here box, and stays current as the job moves along.
          {job.docSentAt ? ` Last emailed ${new Date(job.docSentAt).toLocaleString("en-US", { timeZone: "America/Detroit", dateStyle: "medium", timeStyle: "short" })}.` : " Not emailed yet."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <form action={sendAgreementAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <SubmitButton pendingLabel="Sending…">{job.docSentAt ? `Email it again to ${job.customerEmail}` : `Email it to ${job.customerEmail}`}</SubmitButton>
          </form>
          {!sendable && <span className="text-muted">{job.customerEmail.trim() ? "The price isn't firm yet, so it can't be sent." : "This customer has no email on file."}</span>}
        </div>
        <CopyField label="Or share the link by text or in person" value={contractUrl(job)} />
        {missing && (
          <p className="text-muted">
            Tip: add your business phone, email, license number, and workmanship promise under{" "}
            <Link className="font-semibold text-pine underline" href="/owner/settings">
              Rates
            </Link>{" "}
            so they print on every agreement.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
