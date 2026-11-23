import { describe, expect, it } from "vitest";
import type { JobStatus } from "@/lib/db/types";
import { canLogHours } from "./hours";
import { jobChoice, jobDay, jobWhen, recentJobs } from "./job-pick";

const today = "2026-11-23";

type Sample = { id: string; scope: string; jobSiteAddress: string; scheduledDate: string | null; scheduledDates?: string[]; workDoneOn?: string | null; createdAt: string; updatedAt: string };

function job(id: string, over: Partial<Sample> = {}): Sample {
  return { id, scope: `Job ${id}`, jobSiteAddress: "101 Example Ave, Cadillac, MI 49601", scheduledDate: null, createdAt: "2026-11-01T15:00:00.000Z", updatedAt: "2026-11-01T15:00:00.000Z", ...over };
}

describe("which jobs take hours", () => {
  const website: JobStatus[] = ["quoted", "scope_review", "pending_area", "released"];
  const taken: JobStatus[] = ["held", "booked", "price_change", "in_progress", "awaiting_approval", "disputed", "balance_due", "completed", "reviewed", "cancel_requested"];
  const off: JobStatus[] = ["declined", "referred", "cancelled"];

  it("a job the owner added takes hours at every step until it is called off", () => {
    for (const status of [...website, ...taken]) expect(canLogHours({ status, ownerPriced: true })).toBe(true);
    for (const status of off) expect(canLogHours({ status, ownerPriced: true })).toBe(false);
  });

  it("a website job takes hours once the customer has taken a time", () => {
    for (const status of website) expect(canLogHours({ status })).toBe(false);
    for (const status of taken) expect(canLogHours({ status })).toBe(true);
    for (const status of off) expect(canLogHours({ status })).toBe(false);
  });
});

describe("the job list on a form", () => {
  it("places a job by its schedule, then the day the work was done, then the day it was last changed", () => {
    expect(jobDay(job("a", { scheduledDate: "2026-11-20", scheduledDates: ["2026-11-20", "2026-11-23", "2026-11-24"] }), today)).toBe(today);
    expect(jobDay(job("b", { scheduledDate: "2026-11-18" }), today)).toBe("2026-11-18");
    expect(jobDay(job("c", { scheduledDate: "2026-11-30" }), today)).toBe("2026-11-30");
    expect(jobDay(job("d", { workDoneOn: "2026-11-21" }), today)).toBe("2026-11-21");
    // 3:30 a.m. UTC on the 23rd is still the evening of the 22nd in Michigan.
    expect(jobDay(job("e", { updatedAt: "2026-11-23T03:30:00.000Z" }), today)).toBe("2026-11-22");
  });

  it("puts today's job first, keeps upcoming jobs, and drops anything older than the window", () => {
    const jobs = [
      job("old", { scheduledDate: "2026-09-01" }),
      job("next-week", { scheduledDate: "2026-11-30" }),
      job("last-week", { scheduledDate: "2026-11-17" }),
      job("invoice-today", { workDoneOn: today }),
      job("typed-yesterday", { updatedAt: "2026-11-22T18:00:00.000Z" }),
      job("on-today", { scheduledDate: "2026-11-20", scheduledDates: ["2026-11-20", "2026-11-23"] }),
    ];
    const ids = recentJobs(jobs, today, 60).map((item) => item.id);
    expect(ids.slice(0, 2).sort()).toEqual(["invoice-today", "on-today"]);
    expect(ids.slice(2)).toEqual(["typed-yesterday", "last-week", "next-week"]);
    expect(ids).not.toContain("old");
  });

  it("says when a job is, and shows nothing about the customer or the price", () => {
    expect(jobWhen(job("a", { scheduledDate: "2026-11-23" }))).toBe("Mon, Nov 23");
    expect(jobWhen(job("b", { workDoneOn: "2026-11-21" }))).toBe("Work done Sat, Nov 21");
    expect(jobWhen(job("c"))).toBe("Not scheduled yet");
    expect(Object.keys(jobChoice(job("d"))).sort()).toEqual(["id", "scope", "when", "where"]);
  });
});
