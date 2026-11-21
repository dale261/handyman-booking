import { describe, expect, it } from "vitest";
import type { HoursEntry } from "@/lib/db/types";
import { addDays, checkHours, entriesFor, hoursLabel, isDate, totalHours, weekDays, weekStart, weekTotals } from "./hours";

function entry(workerId: string, workerName: string, date: string, hours: number): HoursEntry {
  return { id: `${workerId}-${date}-${hours}`, workerId, workerName, date, hours, note: "", at: `${date}T20:00:00.000Z` };
}

describe("weeks", () => {
  it("start on Monday and end on Sunday", () => {
    // Nov 21, 2026 is a Saturday.
    expect(weekStart("2026-11-21")).toBe("2026-11-16");
    expect(weekStart("2026-11-16")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16");
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
    expect(weekDays("2026-11-16")).toEqual(["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22"]);
  });

  it("cross a month and a year cleanly", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(weekStart("2027-01-01")).toBe("2026-12-28");
    expect(isDate("2026-02-30")).toBe(false);
    expect(isDate("2026-11-21")).toBe(true);
  });
});

describe("checking an entry", () => {
  const today = "2026-11-21";

  it("accepts quarter hours on a recent day", () => {
    const ok = checkHours({ date: "2026-11-20", hours: 7.25, note: "  Painted trim  " }, today);
    expect(ok).toEqual({ ok: true, date: "2026-11-20", hours: 7.25, note: "Painted trim" });
  });

  it("refuses the future, the distant past, and odd amounts", () => {
    expect(checkHours({ date: "2026-11-22", hours: 2, note: "" }, today).ok).toBe(false);
    expect(checkHours({ date: "2026-09-01", hours: 2, note: "" }, today).ok).toBe(false);
    expect(checkHours({ date: "not a day", hours: 2, note: "" }, today).ok).toBe(false);
    expect(checkHours({ date: today, hours: 0, note: "" }, today).ok).toBe(false);
    expect(checkHours({ date: today, hours: 20, note: "" }, today).ok).toBe(false);
    expect(checkHours({ date: today, hours: 1.1, note: "" }, today).ok).toBe(false);
    expect(checkHours({ date: today, hours: Number.NaN, note: "" }, today).ok).toBe(false);
  });
});

describe("adding up a week", () => {
  const jobs = [
    { id: "job-1", scope: "Paint the great room", hours: [entry("w1", "Alex", "2026-11-16", 8), entry("w1", "Alex", "2026-11-17", 7.5), entry("w2", "Sam", "2026-11-16", 4)] },
    { id: "job-2", scope: "Clear a drain", hours: [entry("w1", "Alex", "2026-11-17", 0.5), entry("w2", "Sam", "2026-11-23", 3)] },
    { id: "job-3", scope: "No hours yet" },
  ];

  it("totals each person by day and by job, busiest first", () => {
    const week = weekTotals(jobs, "2026-11-16");
    expect(week.map((person) => person.workerName)).toEqual(["Alex", "Sam"]);
    expect(week[0].total).toBe(16);
    expect(week[0].byDay["2026-11-17"]).toBe(8);
    expect(week[0].byJob).toEqual([
      { jobId: "job-1", scope: "Paint the great room", hours: 15.5 },
      { jobId: "job-2", scope: "Clear a drain", hours: 0.5 },
    ]);
    // Sam's Monday of the next week is not in this week.
    expect(week[1].total).toBe(4);
  });

  it("is empty for a week with nothing logged", () => {
    expect(weekTotals(jobs, "2026-11-02")).toEqual([]);
  });

  it("lists one person's entries with their jobs, newest first", () => {
    const mine = entriesFor(jobs, "w1", "2026-11-16", "2026-11-22");
    expect(mine.map((line) => `${line.date} ${line.scope} ${line.hours}`)).toEqual([
      "2026-11-17 Paint the great room 7.5",
      "2026-11-17 Clear a drain 0.5",
      "2026-11-16 Paint the great room 8",
    ]);
    expect(totalHours(mine)).toBe(16);
  });

  it("counts shop time with job time, on its own line with no job", () => {
    const shop = [
      { id: "s1", kind: "shop_hours" as const, workerId: "w1", workerName: "Alex", date: "2026-11-18", hours: 1.5, note: "Loaded the truck", at: "2026-11-18T22:00:00.000Z" },
      { id: "s2", kind: "shop_hours" as const, workerId: "w1", workerName: "Alex", date: "2026-11-17", hours: 0.5, note: "", at: "2026-11-17T22:00:00.000Z" },
      // Someone with no job hours at all this week still shows up.
      { id: "s3", kind: "shop_hours" as const, workerId: "w3", workerName: "Jo", date: "2026-11-20", hours: 2, note: "Cleaned sprayers", at: "2026-11-20T22:00:00.000Z" },
      // Outside the week: left out.
      { id: "s4", kind: "shop_hours" as const, workerId: "w3", workerName: "Jo", date: "2026-11-09", hours: 6, note: "", at: "2026-11-09T22:00:00.000Z" },
    ];
    const week = weekTotals(jobs, "2026-11-16", shop);
    expect(week.map((person) => `${person.workerName} ${person.total}`)).toEqual(["Alex 18", "Sam 4", "Jo 2"]);
    expect(week[0].byDay["2026-11-17"]).toBe(8.5);
    expect(week[0].byJob[2]).toEqual({ jobId: "", scope: "Shop time", hours: 2 });
    const mine = entriesFor(jobs, "w1", "2026-11-16", "2026-11-22", shop);
    expect(mine[0]).toMatchObject({ date: "2026-11-18", jobId: "", scope: "Shop time", hours: 1.5, note: "Loaded the truck" });
    expect(totalHours(mine)).toBe(18);
    // A job that isn't listed gets its own line, named the way the crew member typed it.
    const offList = [
      ...shop,
      { id: "u1", kind: "shop_hours" as const, workerId: "w1", workerName: "Alex", unlistedJob: "412 Oak St", date: "2026-11-19", hours: 6, note: "", at: "2026-11-19T22:00:00.000Z" },
      { id: "u2", kind: "shop_hours" as const, workerId: "w1", workerName: "Alex", unlistedJob: "412 oak st", date: "2026-11-20", hours: 2, note: "", at: "2026-11-20T22:00:00.000Z" },
    ];
    const withOffList = weekTotals(jobs, "2026-11-16", offList);
    expect(withOffList[0].total).toBe(26);
    expect(withOffList[0].byJob.slice(2)).toEqual([
      { jobId: "", scope: "Shop time", hours: 2 },
      { jobId: "", scope: "Job not listed: 412 Oak St", hours: 8 },
    ]);
    expect(entriesFor(jobs, "w1", "2026-11-16", "2026-11-22", offList)[0]).toMatchObject({ date: "2026-11-20", jobId: "", scope: "Job not listed: 412 oak st" });
    // Leaving shop time out changes nothing about the job totals.
    expect(weekTotals(jobs, "2026-11-16")[0].total).toBe(16);
  });

  it("labels hours plainly", () => {
    expect(hoursLabel(1)).toBe("1 hr");
    expect(hoursLabel(7.5)).toBe("7.5 hrs");
    expect(hoursLabel(0.1 + 0.2)).toBe("0.3 hrs");
  });
});
