import Link from "next/link";
import { notFound } from "next/navigation";
import { AgreementDocument } from "@/components/agreement-document";
import { Flash } from "@/components/flash";
import { PrintButton } from "@/components/print-button";
import { currentActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { tokenMatches } from "@/lib/services/agreement";

/**
 * The customer's copy, opened from the link we email them. No sign-in needed:
 * the long secret in the link is what proves they were sent it.
 */
export default async function PublicContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ k?: string; notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const repo = getRepository();
  const job = await repo.getJob(id);
  if (!job || !tokenMatches(job, query.k)) notFound();
  const [payments, settings, actor] = await Promise.all([repo.listPayments(job.id), repo.getSettings(), currentActor()]);
  const viewer = actor?.role === "owner" ? "owner" : actor?.id === job.customerId ? "customer" : "public";

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">Your agreement and invoice</h1>
          <p className="text-sm text-muted">
            Read it, sign it at the bottom, and print or save a copy.{" "}
            {viewer === "public" ? (
              <>
                To pick a time or pay online,{" "}
                <Link className="font-semibold text-pine underline" href={`/login?next=${encodeURIComponent(`/jobs/${job.id}`)}`}>
                  sign in
                </Link>
                .
              </>
            ) : (
              <Link className="font-semibold text-pine underline" href={`/jobs/${job.id}`}>
                Open the job page
              </Link>
            )}
          </p>
        </div>
        <PrintButton />
      </div>
      <div className="no-print">
        <Flash notice={query.notice} error={query.error} />
      </div>
      <AgreementDocument job={job} payments={payments} settings={settings} viewer={viewer} token={query.k} />
    </div>
  );
}
