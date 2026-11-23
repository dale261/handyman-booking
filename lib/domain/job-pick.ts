import type { JobRecord } from "@/lib/db/types";
import { addDays } from "@/lib/domain/hours";
import { jobDates } from "@/lib/domain/scheduling";
import { formatDate, formatDateRange, todayDetroit } from "@/lib/format";

/** One line of a job list on a form: enough to tell the job apart, nothing about the customer or the price. */
export type JobChoice = { id: string; scope: string; where: string; when: string };

type Dated = Pick<JobRecord, "scheduledDate" | "scheduledDates" | "workDoneOn" | "createdAt" | "updatedAt">;

/**
 * The day that places a job in time: today when the crew is on it today, otherwise its
 * nearest scheduled day, otherwise the day finished work was done, otherwise the day the
 * job was last changed (a job that is in the app but has no time yet).
 */
export function jobDay(job: Dated, today: string): string {
  const dates = jobDates(job);
  if (dates.includes(today)) return today;
  const past = dates.filter((date) => date < today);
  if (past.length > 0) return past[past.length - 1];
  if (dates.length > 0) return dates[0];
  if (job.workDoneOn) return job.workDoneOn;
  const touched = new Date(job.updatedAt || job.createdAt);
  return Number.isNaN(touched.getTime()) ? today : todayDetroit(touched);
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000;
}

/**
 * Jobs for a pick list: nothing whose day is more than `daysBack` days ago, and the job
 * closest to today first, so today's job is at the top. Upcoming jobs stay in.
 */
export function recentJobs<T extends Dated>(jobs: T[], today: string, daysBack: number): T[] {
  const oldest = addDays(today, -daysBack);
  return jobs
    .map((job) => ({ job, day: jobDay(job, today) }))
    .filter((item) => item.day >= oldest)
    .sort(
      (a, b) =>
        daysApart(a.day, today) - daysApart(b.day, today) ||
        // The same distance: the day that has happened before the day that hasn't.
        a.day.localeCompare(b.day) ||
        (b.job.updatedAt || "").localeCompare(a.job.updatedAt || ""),
    )
    .map((item) => item.job);
}

/** When a job is, in a few words, for the box that spells the picked job out. */
export function jobWhen(job: Dated): string {
  const dates = jobDates(job);
  if (dates.length > 0) return formatDateRange(dates);
  if (job.workDoneOn) return `Work done ${formatDate(job.workDoneOn)}`;
  return "Not scheduled yet";
}

export function jobChoice(job: Dated & Pick<JobRecord, "id" | "scope" | "jobSiteAddress">): JobChoice {
  return { id: job.id, scope: job.scope || "Job", where: job.jobSiteAddress || "", when: jobWhen(job) };
}
