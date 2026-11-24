import { describe, expect, it } from "vitest";
import type { PayItem } from "@/lib/db/types";
import type { LoggedHours } from "./pay";
import { guessPerson, NEW_PERSON, parseCsv, planLoad, readPayFile } from "./pay-load";

const today = "2026-11-24";
const HEAD = "date,worker,job,job_number,hours,rate,pay,note";
const makeId = (key: string) => `id:${key}`;
const now = new Date("2026-11-24T17:00:00.000Z");

const workers = [
  { id: "w-sam", fullName: "Sam Sample", active: true },
  { id: "w-pat", fullName: "Pat Placeholder", active: true },
  { id: "w-kow", fullName: "Alex Kowalski", active: true },
];
const jobs = [
  { id: "j-deck", scope: "Sample deck rebuild", invoiceNumber: 1015, jobSiteAddress: "101 Example Ave, Cadillac, MI 49601" },
  { id: "j-none", scope: "No invoice yet", invoiceNumber: null, jobSiteAddress: "" },
];

function plan(text: string, extra: { logged?: LoggedHours[]; pay?: PayItem[]; choices?: Record<string, string> } = {}) {
  return planLoad({ file: readPayFile(text, today), workers, jobs, logged: extra.logged ?? [], pay: extra.pay ?? [], choices: extra.choices ?? {}, makeId, now });
}

describe("reading the file", () => {
  it("reads quoted cells, doubled quotes and either line ending, and drops blank lines", () => {
    expect(parseCsv('a,b,c\r\n1,"two, with a comma","say ""hi"""\n\n,,\n4,5,6')).toEqual([
      ["a", "b", "c"],
      ["1", "two, with a comma", 'say "hi"'],
      ["4", "5", "6"],
    ]);
    expect(parseCsv("﻿date,worker\n")).toEqual([["date", "worker"]]);
  });

  it("sorts lines into hours at a rate, flat amounts, payments and tracked hours", () => {
    const file = readPayFile(
      [
        HEAD,
        "2026-11-10,Sam,deck,#1015 deck,8,15,120,owed",
        "2026-11-10,Pat,payment,,,,-300,paid $300",
        "2026-11-11,Pat,invoice 1008,#1008,,,150,flat-rate job",
        "2026-11-11,Owner,deck,#1015 deck,6,,,tracking only",
        '2026-11-12,Sam,shop time,,1.5,$15,22.50,"scraped a sign, then swept"',
      ].join("\n"),
      today,
    );
    expect(file.problems).toEqual([]);
    expect(file.lines).toBe(5);
    expect(file.rows.map((row) => [row.line, row.kind, row.hours, row.rate, row.amount])).toEqual([
      [2, "hourly", 8, 15, 120],
      [3, "payment", null, null, 300],
      [4, "flat", null, null, 150],
      [5, "tracked", 6, 0, 0],
      [6, "hourly", 1.5, 15, 22.5],
    ]);
    expect(file.rows[4].note).toBe("scraped a sign, then swept");
  });

  it("keeps the file's pay when it is a cent off hours times rate, and points out a bigger gap", () => {
    const file = readPayFile([HEAD, "2026-11-12,Sam,deck,,4.5,30.77,138.46,", "2026-11-12,Pat,deck,,4,20,100,"].join("\n"), today);
    expect(file.rows.map((row) => row.amount)).toEqual([138.46, 100]);
    expect(file.warnings).toHaveLength(1);
    expect(file.warnings[0]).toContain("Line 3");
  });

  it("names every line it can't use, and refuses a file without the columns", () => {
    const file = readPayFile(
      [HEAD, "11/10/2026,Sam,deck,,8,15,120,", "2026-11-10,,deck,,8,15,120,", "2026-11-10,Sam,deck,,eight,15,120,", "2026-11-10,Sam,deck,,,,,", "2999-01-01,Sam,deck,,8,15,120,", "2026-11-10,Sam,payment,,,,,", "2026-11-10,Sam,deck,,30,15,450,"].join("\n"),
      today,
    );
    expect(file.rows).toHaveLength(0);
    expect(file.problems.map((problem) => problem.slice(0, 7))).toEqual(["Line 2:", "Line 3:", "Line 4:", "Line 5:", "Line 6:", "Line 7:", "Line 8:"]);
    expect(readPayFile("name,amount\nSam,5", today).problems[0]).toContain("Missing: date, worker, job, hours, rate, pay");
    expect(readPayFile("", today).problems).toEqual(["The file is empty."]);
  });
});

describe("who a name in the file is", () => {
  it("matches a full name, a first name, or a nickname inside one name, and gives up when it isn't clear", () => {
    expect(guessPerson("sam sample", workers)).toBe("w-sam");
    expect(guessPerson("Pat", workers)).toBe("w-pat");
    expect(guessPerson("Kowalski", workers)).toBe("w-kow");
    expect(guessPerson("Ski", workers)).toBe("w-kow");
    expect(guessPerson("Hank", workers)).toBeNull();
    expect(guessPerson("Al", workers)).toBeNull();
    expect(guessPerson("Sam", [...workers, { id: "w-sam2", fullName: "Sam Other" }])).toBeNull();
  });
});

describe("what a load would do", () => {
  const text = [
    HEAD,
    "2026-11-10,Sam,deck,#1015 deck (Sample),8,15,120,owed",
    "2026-11-10,Sam,trim,,2,20,40,",
    "2026-11-10,Hank,deck,#1015 deck (Sample),6,10,60,new worker",
    "2026-11-11,Hank,payment,,,,-50,paid $50",
    "2026-11-11,Sam,job 1013,#1013,2,25,50,",
    "2026-11-12,Sam,shop time,,1,15,15,",
  ].join("\n");

  it("matches people and numbered jobs, keeps job names, and adds up what everyone would be owed", () => {
    const made = plan(text);
    expect(made.people).toEqual([
      { name: "Sam", choice: "w-sam", rows: 4 },
      { name: "Hank", choice: NEW_PERSON, rows: 2 },
    ]);
    expect(made.newPeople).toEqual(["Hank"]);
    expect(made.jobs).toEqual([
      { number: 1013, label: "#1013", found: null, rows: 1 },
      { number: 1015, label: "#1015 deck (Sample)", found: { scope: "Sample deck rebuild", where: "101 Example Ave, Cadillac, MI 49601" }, rows: 2 },
    ]);
    expect(made.counts).toMatchObject({ hourly: 5, flat: 0, payments: 1, tracked: 0, linked: 0, skipped: 0, replaced: 0, adding: 6 });
    const lines = made.items.filter((item) => item.kind === "pay");
    expect(lines.map((line) => (line.kind === "pay" ? [line.workerId, line.what, line.jobId] : []))).toEqual([
      ["w-sam", "#1015 deck (Sample)", "j-deck"],
      ["w-sam", "Trim", null],
      ["new:Hank", "#1015 deck (Sample)", "j-deck"],
      ["w-sam", "Job 1013 · #1013", null],
      ["w-sam", "Shop time", null],
    ]);
    expect(made.items.every((item) => item.loaded === true)).toBe(true);
    expect(made.items[0]).toMatchObject({ workerName: "Sam Sample", note: "owed" });
    expect(made.after).toEqual([
      { name: "Sam Sample", earned: 225, paid: 0, owed: 225 },
      { name: "Hank", earned: 60, paid: 50, owed: 10 },
    ]);
  });

  it("goes with the owner's choice of who a name is", () => {
    const made = plan(text, { choices: { Sam: "w-pat", Hank: "w-kow" } });
    expect(made.people.map((person) => person.choice)).toEqual(["w-pat", "w-kow"]);
    expect(made.newPeople).toEqual([]);
    expect(plan(text, { choices: { Sam: NEW_PERSON } }).newPeople).toEqual(["Sam", "Hank"]);
    // A choice that isn't on the crew list is ignored.
    expect(plan(text, { choices: { Sam: "w-gone" } }).people[0].choice).toBe("w-sam");
  });

  it("puts the rate on hours already logged on the site, not a second entry", () => {
    const logged: LoggedHours[] = [
      { entryId: "e-deck", workerId: "w-sam", workerName: "Sam Sample", date: "2026-11-10", hours: 8, note: "", jobId: "j-deck", what: "Sample deck rebuild", at: "x" },
      { entryId: "e-shop", workerId: "w-sam", workerName: "Sam Sample", date: "2026-11-12", hours: 1, note: "", jobId: null, what: "Shop time", at: "x" },
      // The same day and hours on another job doesn't match.
      { entryId: "e-other", workerId: "w-sam", workerName: "Sam Sample", date: "2026-11-10", hours: 2, note: "", jobId: "j-none", what: "No invoice yet", at: "x" },
    ];
    const made = plan(text, { logged });
    expect(made.counts).toMatchObject({ linked: 2, skipped: 0, adding: 6 });
    const linked = made.items.filter((item) => item.kind === "pay" && item.entryId);
    expect(linked.map((item) => (item.kind === "pay" ? [item.entryId, item.jobId, item.rate, item.amount] : []))).toEqual([
      ["e-deck", "j-deck", 15, 120],
      ["e-shop", null, 15, 15],
    ]);
  });

  it("leaves alone a rate the owner already set and a payment he already recorded", () => {
    const logged: LoggedHours[] = [{ entryId: "e-deck", workerId: "w-sam", workerName: "Sam Sample", date: "2026-11-10", hours: 8, note: "", jobId: "j-deck", what: "Sample deck rebuild", at: "x" }];
    const pay: PayItem[] = [
      { id: "site-line", kind: "pay", workerId: "w-sam", workerName: "Sam Sample", date: "2026-11-10", hours: 8, rate: 18, amount: 144, entryId: "e-deck", jobId: "j-deck", what: "Sample deck rebuild", note: "", at: "x" },
      { id: "site-paid", kind: "payment", workerId: "w-kow", workerName: "Alex Kowalski", date: "2026-11-11", amount: 50, note: "", at: "x" },
    ];
    const made = plan(text, { logged, pay, choices: { Hank: "w-kow" } });
    expect(made.counts).toMatchObject({ linked: 0, skipped: 2, adding: 4 });
    expect(made.items.some((item) => item.kind === "payment")).toBe(false);
    // The site's rate won, and the difference is pointed out.
    expect(made.warnings.some((warning) => warning.includes("$18.00") && warning.includes("$15.00"))).toBe(true);
    expect(made.after.find((person) => person.name === "Sam Sample")).toEqual({ name: "Sam Sample", earned: 249, paid: 0, owed: 249 });
  });

  it("replaces an earlier load, and gives the same line the same id every time", () => {
    const first = plan(text);
    const again = plan(text, { pay: first.items });
    expect(again.items.map((item) => item.id)).toEqual(first.items.map((item) => item.id));
    expect(again.counts.replaced).toBe(6);
    expect(again.stale).toEqual([]);
    expect(again.after).toEqual(first.after);

    // A newer file with one line gone and one changed: the old versions are taken off.
    const newer = [HEAD, "2026-11-10,Sam,deck,#1015 deck (Sample),8,15,120,owed", "2026-11-10,Hank,deck,#1015 deck (Sample),6,12,72,corrected rate", "2026-11-11,Hank,payment,,,,-50,paid $50"].join("\n");
    const later = plan(newer, { pay: first.items });
    expect(later.counts.adding).toBe(3);
    expect(later.stale).toHaveLength(4);
    expect(later.after).toEqual([
      { name: "Sam Sample", earned: 120, paid: 0, owed: 120 },
      { name: "Hank", earned: 72, paid: 50, owed: 22 },
    ]);
  });

  it("gives two identical lines their own ids", () => {
    const twice = plan([HEAD, "2026-11-16,Sam,payment,,,,-100,paid $100", "2026-11-16,Sam,payment,,,,-100,paid $100"].join("\n"));
    expect(new Set(twice.items.map((item) => item.id)).size).toBe(2);
    expect(twice.after[0]).toMatchObject({ paid: 200, owed: -200 });
  });

  it("passes problems through and still shows the rest", () => {
    const made = plan([HEAD, "2026-11-10,Sam,deck,,8,15,120,", "bad day,Sam,deck,,8,15,120,"].join("\n"));
    expect(made.problems).toHaveLength(1);
    expect(made.read).toBe(2);
    expect(made.counts.adding).toBe(1);
  });
});
