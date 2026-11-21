import { describe, expect, it } from "vitest";
import type { JobRecord } from "@/lib/db/types";
import { canLogHours } from "@/lib/domain/hours";
import { paidJobIds, pickList } from "@/lib/domain/job-pick-list";

const today = "2026-11-21";

function job(id: string, over: Partial<JobRecord>): JobRecord {
  return { id, scope: `Job ${id}`, jobSiteAddress: `${id} Oak St, Cadillac, MI 49601`, status: "quoted", agreement: null, workDoneOn: null, scheduledDate: null, createdAt: "2026-11-01T12:00:00.000Z", ...over } as JobRecord;
}

const signed = { signedName: "A Customer", signedAt: "2026-11-20T15:00:00.000Z", total: 100, ip: "", userAgent: "" };

describe("which jobs can take hours", () => {
  it("takes a job once the customer has accepted it: signed, paid, booked, or written up after the work", () => {
    expect(canLogHours(job("1", { status: "quoted" }), false)).toBe(false);
    expect(canLogHours(job("1", { status: "quoted", agreement: signed }), false)).toBe(true);
    // Paid first, time picked later.
    expect(canLogHours(job("1", { status: "quoted" }), true)).toBe(true);
    expect(canLogHours(job("1", { status: "booked" }), false)).toBe(true);
    expect(canLogHours(job("1", { status: "in_progress" }), false)).toBe(true);
    expect(canLogHours(job("1", { status: "completed" }), false)).toBe(true);
    expect(canLogHours(job("1", { status: "balance_due", workDoneOn: "2026-11-19" }), false)).toBe(true);
    expect(canLogHours(job("1", { status: "scope_review" }), false)).toBe(false);
    expect(canLogHours(job("1", { status: "held" }), false)).toBe(false);
  });

  it("never takes a job that was cancelled, declined or referred out, even if it was signed", () => {
    expect(canLogHours(job("1", { status: "cancelled", agreement: signed }), true)).toBe(false);
    expect(canLogHours(job("1", { status: "declined" }), false)).toBe(false);
    expect(canLogHours(job("1", { status: "referred" }), false)).toBe(false);
  });
});

describe("the crew's pick list", () => {
  const jobs = [
    job("quote-only", { status: "quoted" }),
    job("signed", { status: "quoted", agreement: signed }),
    job("today", { status: "booked", scheduledDate: "2026-11-21" }),
    job("next-week", { status: "booked", scheduledDate: "2026-11-27" }),
    job("yesterday", { status: "completed", scheduledDate: "2026-11-20" }),
    job("written-up", { status: "balance_due", workDoneOn: "2026-11-19" }),
    job("long-ago", { status: "completed", scheduledDate: "2026-08-01" }),
    job("old-but-owed", { status: "balance_due", workDoneOn: "2026-08-01" }),
    job("cancelled", { status: "cancelled", scheduledDate: "2026-11-21" }),
    job("prepaid", { status: "quoted" }),
  ];
  const paid = paidJobIds([
    { jobId: "prepaid", kind: "full", status: "paid" },
    { jobId: "quote-only", kind: "refund", status: "paid" },
    { jobId: "quote-only", kind: "deposit", status: "pending" },
  ]);

  it("holds every accepted job, nearest to today first, and nothing that wasn't accepted", () => {
    const list = pickList(jobs, paid, today);
    expect(list.map((item) => item.id)).toEqual(["today", "signed", "yesterday", "written-up", "next-week", "prepaid", "old-but-owed"]);
  });

  it("drops finished jobs after a while but keeps ones still owed", () => {
    const ids = pickList(jobs, paid, today).map((item) => item.id);
    expect(ids).not.toContain("long-ago");
    expect(ids).toContain("old-but-owed");
    expect(ids).not.toContain("cancelled");
    expect(ids).not.toContain("quote-only");
  });

  it("says where and when for each one", () => {
    const list = pickList(jobs, paid, today);
    const written = list.find((item) => item.id === "written-up");
    expect(written?.where).toBe("written-up Oak St, Cadillac, MI 49601");
    expect(written?.when).toMatch(/^Done /);
    expect(list.find((item) => item.id === "signed")?.when).toBe("No time set yet");
  });

  it("stops at the size a phone list can handle", () => {
    const many = Array.from({ length: 60 }, (_, i) => job(`j${i}`, { status: "booked", scheduledDate: "2026-11-21" }));
    expect(pickList(many, new Set(), today)).toHaveLength(40);
  });
});
