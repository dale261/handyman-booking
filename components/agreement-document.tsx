import Image from "next/image";
import { signAgreementAction } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { JobRecord, PaymentRecord } from "@/lib/db/types";
import { accepted, agreementTerms, canSign, invoiceSummary } from "@/lib/domain/agreement";
import type { Settings } from "@/lib/domain/types";
import { formatMinutes, jobUrl, usd } from "@/lib/format";
import { daysOf, jobDates } from "@/lib/domain/scheduling";
import { STATUS_LABEL, statusTone } from "@/lib/labels";
import { paypalConfigured } from "@/lib/paypal";

const TZ = "America/Detroit";

/** "November 7, 2026" for a calendar date like 2026-11-07. */
function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return isoDate;
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** "Oct 30, 2026, 7:15 PM" for a timestamp, in Michigan time. */
function stamp(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" });
}

function paymentLabel(kind: PaymentRecord["kind"]): string {
  if (kind === "deposit") return "Deposit";
  if (kind === "balance") return "Balance";
  if (kind === "refund") return "Refund";
  return "Payment";
}

function methodLabel(method: PaymentRecord["method"]): string {
  if (method === "paypal") return "PayPal";
  if (method === "check") return "Check";
  return "Cash";
}

export type DocumentViewer = "owner" | "customer" | "worker" | "public";

/**
 * The agreement and invoice for one job, built from the job record. Printable.
 * The sign-here form shows for the customer (signed in, or holding the emailed link)
 * while the price is firm and nothing has been signed yet.
 */
export function AgreementDocument({
  job,
  payments,
  settings,
  crewName,
  viewer,
  token,
}: {
  job: JobRecord;
  payments: PaymentRecord[];
  settings: Settings;
  crewName?: string;
  viewer: DocumentViewer;
  /** The link secret, when the page was opened from the emailed link. */
  token?: string;
}) {
  const summary = invoiceSummary(job, payments);
  const terms = agreementTerms(job, settings);
  const contact = [settings.businessPhone, settings.businessEmail].filter(Boolean);
  const paidPayments = payments.filter((payment) => !payment.closed && (payment.kind === "refund" || payment.status === "paid"));
  const firstPaid = paidPayments.find((payment) => payment.kind !== "refund");
  const showSign = (viewer === "customer" || viewer === "public") && !job.agreement && canSign(job.status);
  const priceChanged = job.agreement != null && Math.abs(job.agreement.total - job.total) >= 0.01;
  const issued = job.invoiceNumber != null;
  const hours = job.onsiteMinutes / 60;
  const hoursLabel = hours >= 1 ? `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? "" : "s"}` : `${job.onsiteMinutes} minutes`;
  const dates = jobDates(job);
  const days = Math.max(daysOf(job), dates.length);

  return (
    <article className="mx-auto max-w-3xl space-y-8 rounded-xl border border-line bg-card p-6 text-ink shadow-sm print:max-w-none print:space-y-6 print:rounded-none print:border-0 print:p-0 print:shadow-none sm:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-5">
        <div className="flex items-start gap-3">
          <Image src="/brand/logo-header.png" alt="" width={48} height={48} className="h-12 w-12" />
          <div className="text-sm">
            <p className="font-display text-xl font-semibold">{settings.businessName}</p>
            <p>{settings.shopAddress}</p>
            {contact.length > 0 && <p>{contact.join(" · ")}</p>}
            {settings.licenseNumber && <p>Michigan license no. {settings.licenseNumber}</p>}
          </div>
        </div>
        <div className="text-sm sm:text-right">
          <h1 className="font-display text-2xl font-semibold">Agreement and invoice</h1>
          <p className="font-semibold">{issued ? `Invoice #${job.invoiceNumber}` : "Invoice number issued when a time is booked"}</p>
          <p>Prepared {stamp(job.createdAt)}</p>
          <p className="mt-1">
            <Badge tone={statusTone(job.status)}>{STATUS_LABEL[job.status]}</Badge>
          </p>
        </div>
      </header>

      <section className="grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <h2 className="font-display text-base font-semibold">Customer</h2>
          <p className="font-semibold">{job.customerName}</p>
          <p>{job.customerPhone}</p>
          <p>{job.customerEmail}</p>
          <p className="text-muted">{job.billingAddress}</p>
        </div>
        <div>
          <h2 className="font-display text-base font-semibold">Job site</h2>
          <p>{job.jobSiteAddress}</p>
          {(job.city || job.county) && (
            <p className="text-muted">
              {job.city} {job.jobZip}
              {job.county ? ` · ${job.county} County` : ""}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-2 text-sm">
        <h2 className="font-display text-lg font-semibold">The work</h2>
        <p className="text-base font-semibold">{job.scope || "Job"}</p>
        {job.description && job.description !== job.scope && <p className="whitespace-pre-line">{job.description}</p>}
        <p>
          {job.scheduledDate ? (
            <>
              <span className="font-semibold">Scheduled:</span>{" "}
              {dates.length > 1
                ? `${longDate(dates[0])} through ${longDate(dates[dates.length - 1])} (${dates.length} working days), starting ${formatMinutes(job.startMin || 0)} each day`
                : `${longDate(job.scheduledDate)} at ${formatMinutes(job.startMin || 0)}`}
              {crewName && viewer !== "public" ? ` · ${crewName}` : ""}
              {job.status === "held" && job.holdUntil ? ` (held until ${stamp(job.holdUntil)}, pending payment)` : ""}
            </>
          ) : (
            <>
              <span className="font-semibold">Scheduled:</span> not yet{days > 1 ? ` (${days} working days)` : ""}. The customer picks an open time, or we set one together.
            </>
          )}
        </p>
        <p>
          <span className="font-semibold">Time on site:</span> about {hoursLabel}
          {days > 1 ? " a day" : ""}
          {job.crewSize && job.crewSize > 1 ? `, ${job.crewSize} people` : ""}.
        </p>
      </section>

      <section className="space-y-3 text-sm print:break-inside-avoid">
        <h2 className="font-display text-lg font-semibold">Price</h2>
        <table className="w-full">
          <thead>
            <tr className="text-left text-muted">
              <th className="py-1 pr-3 font-semibold">Item</th>
              <th className="py-1 pr-3 font-semibold">Details</th>
              <th className="py-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {job.lines.map((line, index) => (
              <tr key={`${line.label}-${index}`} className="border-t border-line align-top">
                <td className="py-2 pr-3">{line.label}</td>
                <td className="py-2 pr-3 text-muted">{line.detail}</td>
                <td className="py-2 text-right">{usd(line.amount)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-ink">
              <td className="py-2 font-semibold">Total</td>
              <td />
              <td className="py-2 text-right text-base font-semibold">{usd(job.total)}</td>
            </tr>
          </tbody>
        </table>
        {job.payRule && <p>{job.payRule}</p>}
        {job.assumptions.length > 0 && (
          <div>
            <p className="font-semibold">What this covers</p>
            <ul className="list-disc space-y-1 pl-5">
              {job.assumptions
                .filter((item) => !item.startsWith("This is an estimate based on your description") && !item.startsWith("We'll review this before you can book") && !item.startsWith("Dale will review this before you can book"))
                .map((item) => (
                  <li key={item}>{item}</li>
                ))}
            </ul>
          </div>
        )}
        {(job.priceChanges ?? []).filter((change) => change.outcome === "approved").length > 0 && (
          <div>
            <p className="font-semibold">Approved price changes</p>
            <ul className="list-disc space-y-1 pl-5">
              {(job.priceChanges ?? [])
                .filter((change) => change.outcome === "approved")
                .map((change) => (
                  <li key={change.at}>
                    {stamp(change.at)}: {usd(change.previousTotal)} to {usd(change.proposedTotal)}. {change.reason}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </section>

      <section className="space-y-3 text-sm print:break-inside-avoid">
        <h2 className="font-display text-lg font-semibold">{issued ? `Invoice #${job.invoiceNumber}` : "Invoice"}</h2>
        {paidPayments.length > 0 ? (
          <table className="w-full">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-3 font-semibold">Date</th>
                <th className="py-1 pr-3 font-semibold">Payment</th>
                <th className="py-1 pr-3 font-semibold">Method</th>
                <th className="py-1 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {paidPayments.map((payment) => (
                <tr key={payment.id} className="border-t border-line">
                  <td className="py-2 pr-3">{stamp(payment.createdAt)}</td>
                  <td className="py-2 pr-3">
                    {paymentLabel(payment.kind)}
                    {payment.kind === "refund" && payment.status !== "sent" ? " (pending)" : ""}
                  </td>
                  <td className="py-2 pr-3">{methodLabel(payment.method)}</td>
                  <td className="py-2 text-right">
                    {payment.kind === "refund" ? "−" : ""}
                    {usd(payment.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted">No payments yet.</p>
        )}
        <div className="grid gap-1 sm:max-w-xs sm:ml-auto">
          <p className="flex justify-between gap-4">
            <span>Total</span>
            <span>{usd(summary.total)}</span>
          </p>
          <p className="flex justify-between gap-4">
            <span>Paid</span>
            <span>{usd(summary.paid)}</span>
          </p>
          <p className="flex justify-between gap-4 border-t border-ink pt-1 font-semibold">
            <span>Balance</span>
            <span>{usd(summary.balance)}</span>
          </p>
        </div>
        <p className="font-semibold">{summary.dueLabel}</p>
        {summary.balance > 0 && job.status !== "cancelled" && (
          <p>
            <span className="font-semibold">How to pay:</span>{" "}
            {paypalConfigured() ? `online with PayPal from your job page (${jobUrl(job.id)}), or ` : ""}
            by check payable to {settings.businessName}, or cash. We mark checks and cash paid when we receive them.
          </p>
        )}
      </section>

      <section className="space-y-4 text-sm">
        <h2 className="font-display text-lg font-semibold">Terms</h2>
        <ol className="space-y-3 pl-5">
          {terms.map((section) => (
            <li key={section.title} className="list-decimal print:break-inside-avoid">
              <p className="font-semibold">{section.title}</p>
              {section.body.map((paragraph, index) => (
                <p key={index} className="mt-1">
                  {paragraph}
                </p>
              ))}
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3 border-t border-line pt-5 text-sm print:break-inside-avoid">
        <h2 className="font-display text-lg font-semibold">Acceptance</h2>
        {job.agreement ? (
          <div className="rounded-md border border-pine/30 bg-pine/5 px-3 py-2">
            <p>
              Signed by <span className="font-semibold">{job.agreement.signedName}</span> on {stamp(job.agreement.signedAt)} for {usd(job.agreement.total)}.
            </p>
            {priceChanged && <p className="text-muted">The price has since changed to {usd(job.total)} through a change the customer approved on their job page.</p>}
            {viewer === "owner" && <p className="text-muted">Recorded from {job.agreement.ip}.</p>}
          </div>
        ) : accepted(job, payments) && firstPaid ? (
          <p>
            Accepted by payment: {usd(firstPaid.amount)} by {methodLabel(firstPaid.method)} on {stamp(firstPaid.createdAt)}.
          </p>
        ) : (
          <p className="text-muted">Not signed yet.</p>
        )}
        <p>
          For {settings.businessName}: prepared {stamp(job.createdAt)}
          {issued ? `, invoice #${job.invoiceNumber}` : ""}.
        </p>
        {showSign && (
          <form action={signAgreementAction} className="no-print space-y-3 rounded-md border border-line bg-paper p-4">
            <input type="hidden" name="jobId" value={job.id} />
            {token && <input type="hidden" name="token" value={token} />}
            <p className="font-semibold">Sign here</p>
            <label className="grid gap-1">
              Type your full name
              <Input name="signedName" required minLength={3} maxLength={120} autoComplete="name" placeholder={job.customerName} />
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" name="agree" required className="mt-1" />
              <span>I have read this agreement, including the price of {usd(job.total)} and the terms above, and I agree to it.</span>
            </label>
            <SubmitButton pendingLabel="Signing…">Sign the agreement</SubmitButton>
          </form>
        )}
      </section>
    </article>
  );
}
