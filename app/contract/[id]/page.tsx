import Link from "next/link";
import { notFound } from "next/navigation";
import { AgreementDocument } from "@/components/agreement-document";
import { Flash } from "@/components/flash";
import { LinkPayCard, LinkTimePicker } from "@/components/link-tools";
import { PrintButton } from "@/components/print-button";
import { currentActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { invoiceOnly } from "@/lib/domain/agreement";
import { linkActor, tokenMatches } from "@/lib/services/agreement";
import { amountPaid, amountPayable, listOpenSlots, prepaid, type SlotOption } from "@/lib/services/booking";

/**
 * The customer's copy, opened from the link we email them. No sign-in needed:
 * the long secret in the link is what proves they were sent it, and it lets them
 * do everything the job needs from them: pick a time, sign, and pay.
 */
export default async function PublicContractPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ k?: string; notice?: string; error?: string; date?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const repo = getRepository();
  const job = await repo.getJob(id);
  if (!job || !tokenMatches(job, query.k)) notFound();
  const token = query.k ?? "";
  const [payments, settings, actor] = await Promise.all([repo.listPayments(job.id), repo.getSettings(), currentActor()]);
  const viewer = actor?.role === "owner" ? "owner" : actor?.id === job.customerId ? "customer" : "public";

  const canSchedule = ["quoted", "released", "pending_area"].includes(job.status) && job.licenseLevel === "ok";
  let slots: SlotOption[] = [];
  let slotError = "";
  if (canSchedule) {
    const listed = await listOpenSlots(repo, linkActor(job), job.id);
    if (listed.ok) slots = listed.data;
    else slotError = listed.error;
  }
  const dates = [...new Set(slots.map((slot) => slot.date))];
  const selectedDate = query.date && dates.includes(query.date) ? query.date : dates[0];
  const due = amountPayable(job);
  const paidUpFront = prepaid(job, amountPaid(payments, job.id));

  // Finished work: an invoice to pay, nothing to schedule or sign.
  const invoice = invoiceOnly(job);
  const todo = invoice
    ? [due > 0 ? "pay" : ""].filter(Boolean)
    : [canSchedule ? "pick a time" : "", due > 0 ? "pay" : "", job.agreement ? "" : "sign it at the bottom"].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="no-print flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-semibold text-ink">{invoice ? "Your invoice" : "Your agreement and invoice"}</h1>
          <p className="text-sm text-muted">
            {todo.length > 0 ? `Everything happens right here, no sign-in needed: ${todo.join(", ")}.` : invoice && due === 0 ? "This invoice is settled. Keep this link for your records." : "Keep this link; it stays current as the job moves along."}{" "}
            Print or save a copy any time.{" "}
            {viewer !== "public" && (
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
      {due > 0 && <LinkPayCard job={job} token={token} due={due} />}
      {canSchedule && <LinkTimePicker job={job} token={token} slots={slots} slotError={slotError} selectedDate={selectedDate} paidUpFront={paidUpFront} />}
      <AgreementDocument job={job} payments={payments} settings={settings} viewer={viewer} token={token} />
    </div>
  );
}
