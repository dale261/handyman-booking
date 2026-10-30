import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, JobRecord } from "@/lib/db/types";
import { canSign, invoiceSummary } from "@/lib/domain/agreement";
import { splitPayment } from "@/lib/domain/pricing";
import { contractUrl, formatDate, formatMinutes, usd } from "@/lib/format";
import { emailFooter, mail, notify } from "@/lib/services/booking";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

export function newDocToken(): string {
  return randomBytes(24).toString("hex");
}

/** Constant-time check of the secret in a contract link. */
export function tokenMatches(job: Pick<JobRecord, "docToken">, token: string | null | undefined): boolean {
  if (!job.docToken || !token) return false;
  const a = Buffer.from(job.docToken);
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Jobs saved before contract links existed get a secret the first time the owner opens the page. */
export async function ensureDocToken(repo: Repository, job: JobRecord): Promise<JobRecord> {
  if (job.docToken) return job;
  job.docToken = newDocToken();
  return repo.saveJob(job, { skipOverlap: true });
}

/**
 * Record the customer's typed signature. Either the signed-in customer who owns the
 * job or someone holding the job's contract link can sign; the owner cannot sign for them.
 */
export async function signAgreement(
  repo: Repository,
  input: { jobId: string; actor: Actor | null; token: string | null; signedName: string; ip: string; userAgent: string },
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(input.jobId);
    if (!job) return fail("Job not found.");
    const owns = input.actor?.role === "customer" && input.actor.id === job.customerId;
    if (!owns && !tokenMatches(job, input.token)) return fail("This link doesn't match the job. Open the agreement from the email we sent you.");
    if (job.agreement) return { ok: true, data: job };
    if (!canSign(job.status)) return fail("This job isn't ready to sign. The price has to be firm first.");
    const signedName = input.signedName.replace(/\s+/g, " ").trim();
    if (signedName.length < 3) return fail("Type your full name to sign.");
    if (signedName.length > 120) return fail("That name is too long.");
    job.agreement = {
      signedName,
      signedAt: new Date().toISOString(),
      total: job.total,
      ip: input.ip.slice(0, 80),
      userAgent: input.userAgent.slice(0, 200),
    };
    const saved = await repo.saveJob(job, { skipOverlap: true });
    const settings = await repo.getSettings();
    await notify(
      repo,
      settings,
      "signed",
      `Agreement signed: ${saved.scope || "job"}${saved.invoiceNumber ? ` (invoice #${saved.invoiceNumber})` : ""}`,
      `${signedName} signed for ${usd(saved.total)} at ${saved.jobSiteAddress}.${saved.scheduledDate ? ` Scheduled ${formatDate(saved.scheduledDate)} at ${formatMinutes(saved.startMin || 0)}.` : " No time booked yet."}`,
      saved.id,
    );
    await mail(
      repo,
      saved.customerEmail,
      `Your signed agreement with ${settings.businessName}${saved.invoiceNumber ? `, invoice #${saved.invoiceNumber}` : ""}`,
      `Hi ${saved.customerName}, thanks. We recorded your signature on the agreement for ${saved.scope || "your job"} at ${usd(saved.total)}.\n\nYour copy, with the invoice, is here any time: ${contractUrl(saved)}${emailFooter(settings)}`,
      saved.id,
    );
    return { ok: true, data: saved };
  });
}

/** Owner only: email the customer their contract and invoice link. */
export async function sendAgreement(repo: Repository, actor: Actor, jobId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can send the agreement.");
    let job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (!job.customerEmail.trim()) return fail("This customer has no email address on file.");
    if (!canSign(job.status)) return fail("The price isn't firm yet, so there's nothing to send.");
    job = await ensureDocToken(repo, job);
    const settings = await repo.getSettings();
    const payments = await repo.listPayments(job.id);
    const summary = invoiceSummary(job, payments);
    const split = splitPayment(job.total, settings.depositThreshold);
    const invoice = job.invoiceNumber ? `invoice #${job.invoiceNumber}` : "agreement";
    const when = job.scheduledDate ? ` on ${formatDate(job.scheduledDate)} at ${formatMinutes(job.startMin || 0)}` : "";
    const pay =
      summary.paid > 0
        ? `You've paid ${usd(summary.paid)}. ${summary.dueLabel}`
        : split.later > 0
          ? `${usd(split.now)} is due to book (half down) and ${usd(split.later)} after you approve the finished work.`
          : `${usd(split.now)} is due to book.`;
    await mail(
      repo,
      job.customerEmail,
      `Your agreement and ${invoice} from ${settings.businessName}`,
      `Hi ${job.customerName}, here is the agreement and invoice for ${job.scope || "your job"}${when}. The price is ${usd(job.total)}. ${pay}\n\nRead it, sign it, and keep a copy here: ${contractUrl(job)}\n\nYou can print it or save it as a PDF from that page. Reply to this email with any questions.${emailFooter(settings)}`,
      job.id,
    );
    job.docSentAt = new Date().toISOString();
    const saved = await repo.saveJob(job, { skipOverlap: true });
    return { ok: true, data: saved };
  });
}
