import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { formatDateRange, usd } from "@/lib/format";
import { jobDates } from "@/lib/domain/scheduling";
import { STATUS_LABEL, statusTone } from "@/lib/labels";

export default async function OwnerJobsPage() {
  await requireRole("owner");
  const jobs = (await getRepository().listJobs()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">All jobs</h1>
          <p className="text-sm text-muted">Every job has a contract and invoice page built from its record.</p>
        </div>
        <Link href="/owner/jobs/new" className="inline-flex h-10 items-center rounded-md bg-pine px-4 text-sm font-semibold text-white hover:bg-pine-deep">
          Add a job (phone or in person)
        </Link>
      </div>
      {jobs.length === 0 ? (
        <p className="text-sm text-muted">No jobs yet. The first real invoice will be number 1000.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="text-left text-muted">
                <th className="px-3 py-2">Invoice</th>
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Job</th>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Contract</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} className="border-t border-line">
                  <td className="px-3 py-2">{job.invoiceNumber ?? "—"}</td>
                  <td className="px-3 py-2">{job.customerName}</td>
                  <td className="px-3 py-2">
                    <Link className="font-semibold text-pine underline" href={`/jobs/${job.id}`}>{job.scope || job.description}</Link>
                    {job.ownerPriced && <span className="ml-2 text-xs text-muted">phone job</span>}
                  </td>
                  <td className="px-3 py-2">{job.scheduledDate ? formatDateRange(jobDates(job)) : "—"}</td>
                  <td className="px-3 py-2 text-right">{usd(job.total)}</td>
                  <td className="px-3 py-2"><Badge tone={statusTone(job.status)}>{STATUS_LABEL[job.status]}</Badge></td>
                  <td className="px-3 py-2">
                    <Link className="font-semibold text-pine underline" href={`/jobs/${job.id}/contract`}>
                      {job.agreement ? "Signed" : job.docSentAt ? "Sent" : "Open"}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
