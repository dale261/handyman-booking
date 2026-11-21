import type { JobRecord } from "@/lib/db/types";
import { addDays, canLogHours } from "@/lib/domain/hours";
import type { PickJob } from "@/lib/domain/job-pick";
import { jobDates } from "@/lib/domain/scheduling";
import { formatDate, formatDateRange } from "@/lib/format";

type Listed = Pick<JobRecord, "id" | "scope" | "jobSiteAddress" | "status" | "agreement" | "workDoneOn" | "scheduledDate" | "scheduledDates" | "createdAt">;

/** The day a job belongs to, for sorting: when the work was done, its last scheduled day, or when it came in. */
function jobDay(job: Listed): string {
  if (job.workDoneOn) return job.workDoneOn;
  if (job.scheduledDate) {
    const dates = jobDates(job);
    return dates[dates.length - 1] ?? job.scheduledDate;
  }
  return (job.agreement?.signedAt ?? job.createdAt ?? "").slice(0, 10);
}

function dayNumber(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d) ? Date.UTC(y, m - 1, d) / 86_400_000 : 0;
}

/**
 * The jobs a crew member can pick: every accepted job (see canLogHours), whichever crew it
 * is on. Finished jobs drop off after `daysBack` days. Jobs nearest to today come first,
 * because that is nearly always the one they mean.
 */
export function pickList(jobs: Listed[], paidJobIds: Set<string>, today: string, daysBack = 45, max = 40): PickJob[] {
  const cutoff = addDays(today, -daysBack);
  const now = dayNumber(today);
  return jobs
    .filter((job) => canLogHours(job, paidJobIds.has(job.id)))
    .map((job) => ({ job, day: jobDay(job) }))
    .filter(({ job, day }) => (job.status !== "completed" && job.status !== "reviewed") || !day || day >= cutoff)
    .sort((a, b) => Math.abs(dayNumber(a.day) - now) - Math.abs(dayNumber(b.day) - now) || (a.job.scope || "").localeCompare(b.job.scope || ""))
    .slice(0, max)
    .map(({ job }) => ({
      id: job.id,
      scope: job.scope || "Job",
      where: job.jobSiteAddress || "",
      when: job.workDoneOn ? `Done ${formatDate(job.workDoneOn)}` : job.scheduledDate ? formatDateRange(jobDates(job)) : "No time set yet",
    }));
}

/** The ids of jobs a customer has paid something on. */
export function paidJobIds(payments: { jobId: string; kind: string; status: string }[]): Set<string> {
  return new Set(payments.filter((payment) => payment.kind !== "refund" && payment.status === "paid").map((payment) => payment.jobId));
}
