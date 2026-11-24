import { describe, expect, it } from "vitest";
import type { CrewPayment, CrewRate, PayItem, PayLine, ShopHoursEntry } from "@/lib/db/types";
import { balances, checkAmount, checkFlatPay, checkPayDay, checkPayment, checkRate, lastRates, lineFor, loggedHours, methodLabel, needsRate, payFor, rateFor, rateId, readMethod, seenJobRates, suggestRate, totalOwed } from "./pay";

const today = "2026-11-24";

let n = 0;
function line(over: Partial<PayLine>): PayLine {
  n += 1;
  return { id: `l${n}`, kind: "pay", workerId: "w1", workerName: "Sam Sample", date: "2026-11-20", hours: 4, rate: 20, amount: 80, entryId: `e${n}`, jobId: "j1", what: "Sample deck", note: "", at: `2026-11-20T15:00:${String(n).padStart(2, "0")}.000Z`, ...over };
}
function payment(over: Partial<CrewPayment>): CrewPayment {
  n += 1;
  return { id: `p${n}`, kind: "payment", workerId: "w1", workerName: "Sam Sample", date: "2026-11-21", amount: 50, note: "", at: `2026-11-21T15:00:${String(n).padStart(2, "0")}.000Z`, ...over };
}

describe("checking what the owner types", () => {
  it("takes a rate to the cent, and zero for hours that are tracked but not paid", () => {
    expect(checkRate(20)).toEqual({ ok: true, rate: 20 });
    expect(checkRate(30.77)).toEqual({ ok: true, rate: 30.77 });
    expect(checkRate(0)).toEqual({ ok: true, rate: 0 });
    expect(checkRate(-1).ok).toBe(false);
    expect(checkRate(Number.NaN).ok).toBe(false);
    expect(checkRate(501).ok).toBe(false);
  });

  it("works hourly pay out as hours times rate, to the cent", () => {
    expect(payFor(5.5, 35)).toBe(192.5);
    expect(payFor(3.5, 15)).toBe(52.5);
    expect(payFor(8, 0)).toBe(0);
    expect(payFor(2, 30.77)).toBe(61.54);
  });

  it("takes old days but not days that haven't happened", () => {
    expect(checkPayDay("2026-10-28", today)).toEqual({ ok: true, date: "2026-10-28" });
    expect(checkPayDay("2026-11-25", today).ok).toBe(false);
    expect(checkPayDay("2024-01-01", today).ok).toBe(false);
    expect(checkPayDay("11/20/2026", today).ok).toBe(false);
  });

  it("wants a real amount, and a few words for flat pay", () => {
    expect(checkAmount(150)).toEqual({ ok: true, amount: 150 });
    expect(checkAmount(0).ok).toBe(false);
    expect(checkAmount(-60).ok).toBe(false);
    expect(checkAmount(50001).ok).toBe(false);
    expect(checkFlatPay({ date: today, amount: 150, what: "  Flat rate,   split two ways " }, today)).toEqual({ ok: true, date: today, amount: 150, what: "Flat rate, split two ways" });
    expect(checkFlatPay({ date: today, amount: 150, what: " " }, today).ok).toBe(false);
    expect(checkPayment({ date: today, amount: 100.005, note: "" }, today)).toEqual({ ok: true, date: today, amount: 100.01, note: "" });
  });
});

describe("hours that need a rate", () => {
  const jobs = [
    { id: "j1", scope: "Sample deck", hours: [{ id: "e-a", workerId: "w1", workerName: "Sam Sample", date: "2026-11-23", hours: 4, note: "Railings", at: "2026-11-23T20:00:00.000Z" }] },
    { id: "j2", scope: "Sample paint", hours: [{ id: "e-b", workerId: "w2", workerName: "Pat Placeholder", date: "2026-11-22", hours: 6, note: "", at: "2026-11-22T20:00:00.000Z" }] },
    { id: "j3", scope: "No hours yet" },
  ];
  const shop: ShopHoursEntry[] = [{ id: "e-c", kind: "shop_hours", workerId: "w1", workerName: "Sam Sample", date: "2026-11-24", hours: 1, note: "Loaded the truck", at: "2026-11-24T14:00:00.000Z" }];

  it("lists job hours and shop time together, newest day first", () => {
    const all = loggedHours(jobs, shop);
    expect(all.map((entry) => entry.entryId)).toEqual(["e-c", "e-a", "e-b"]);
    expect(all[0]).toMatchObject({ jobId: null, what: "Shop time", hours: 1 });
    expect(all[1]).toMatchObject({ jobId: "j1", what: "Sample deck", note: "Railings" });
  });

  it("drops entries once pay is set on them, and never lists the people it is told to skip", () => {
    const all = loggedHours(jobs, shop);
    expect(needsRate(all, [])).toHaveLength(3);
    const pay: PayItem[] = [line({ entryId: "e-a" }), payment({})];
    expect(needsRate(all, pay).map((entry) => entry.entryId)).toEqual(["e-c", "e-b"]);
    expect(needsRate(all, pay, ["w2"]).map((entry) => entry.entryId)).toEqual(["e-c"]);
    expect(lineFor(pay, "e-a")?.entryId).toBe("e-a");
    expect(lineFor(pay, "e-b")).toBeUndefined();
  });
});

describe("a rate to offer", () => {
  const pay: PayItem[] = [
    line({ date: "2026-11-10", jobId: "j1", rate: 10 }),
    line({ date: "2026-11-12", jobId: "j2", rate: 15 }),
    line({ date: "2026-11-14", jobId: "j1", rate: 20 }),
    line({ date: "2026-11-15", jobId: null, what: "Shop time", rate: 12 }),
    line({ date: "2026-11-16", jobId: null, what: "Flat rate for siding", hours: null, rate: null, amount: 200, entryId: null }),
    line({ date: "2026-11-18", workerId: "w2", jobId: "j1", rate: 35 }),
    payment({}),
  ];

  it("offers what they last got on the same job", () => {
    expect(suggestRate(pay, "w1", "j1")).toEqual({ rate: 20, from: "this job" });
    expect(suggestRate(pay, "w1", "j2")).toEqual({ rate: 15, from: "this job" });
    expect(suggestRate(pay, "w2", "j1")).toEqual({ rate: 35, from: "this job" });
  });

  it("offers their last shop rate for shop time", () => {
    expect(suggestRate(pay, "w1", null)).toEqual({ rate: 12, from: "shop time" });
  });

  it("falls back to their latest rate anywhere, and offers nothing for someone with no rate on record", () => {
    expect(suggestRate(pay, "w1", "j9")).toEqual({ rate: 12, from: "other work" });
    expect(suggestRate(pay, "w2", null)).toEqual({ rate: 35, from: "other work" });
    expect(suggestRate(pay, "w3", "j1")).toBeNull();
  });
});

describe("what each person is owed", () => {
  it("is what they earned less what they were paid, most owed first", () => {
    const pay: PayItem[] = [
      line({ workerId: "w1", workerName: "Sam Sample", amount: 180 }),
      line({ workerId: "w1", workerName: "Sam Sample", amount: 105.5 }),
      payment({ workerId: "w1", workerName: "Sam Sample", amount: 100, date: "2026-11-21" }),
      payment({ workerId: "w1", workerName: "Sam Sample", amount: 50, date: "2026-11-19" }),
      line({ workerId: "w2", workerName: "Pat Placeholder", amount: 192.5 }),
      payment({ workerId: "w2", workerName: "Pat Placeholder", amount: 200, date: "2026-11-20" }),
      line({ workerId: "w3", workerName: "Flat Rate Fran", hours: null, rate: null, entryId: null, amount: 150 }),
      payment({ workerId: "w3", workerName: "Flat Rate Fran", amount: 150 }),
    ];
    const list = balances(pay);
    expect(list.map((person) => [person.workerName, person.earned, person.paid, person.owed])).toEqual([
      ["Sam Sample", 285.5, 150, 135.5],
      ["Flat Rate Fran", 150, 150, 0],
      ["Pat Placeholder", 192.5, 200, -7.5],
    ]);
    expect(list[0].lastPaid).toBe("2026-11-21");
    // Someone paid ahead doesn't bring down what the others are owed.
    expect(totalOwed(list)).toBe(135.5);
    expect(balances([])).toEqual([]);
  });

  it("adds cents without drift", () => {
    const pay: PayItem[] = Array.from({ length: 30 }, () => line({ amount: 0.1 }));
    expect(balances(pay)[0].earned).toBe(3);
  });
});

function listed(workerId: string, scope: string, rate: number): CrewRate {
  return { id: rateId(workerId, scope), workerId, scope, rate, updatedAt: "2026-11-24T12:00:00.000Z" };
}

describe("the rate list", () => {
  const rates = [listed("w1", "usual", 35), listed("w1", "shop", 15), listed("w1", "j1", 30), listed("w2", "j1", 10), listed("w3", "usual", 0)];

  it("gives job hours the rate for that job, else the person's usual rate", () => {
    expect(rateFor(rates, "w1", "j1")).toEqual({ rate: 30, from: "job" });
    expect(rateFor(rates, "w1", "j2")).toEqual({ rate: 35, from: "usual" });
    expect(rateFor(rates, "w2", "j1")).toEqual({ rate: 10, from: "job" });
    // A rate of zero is a real rate: tracked, not paid.
    expect(rateFor(rates, "w3", "j1")).toEqual({ rate: 0, from: "usual" });
  });

  it("says nothing when the list has no rate for the hours, so they wait for the owner", () => {
    expect(rateFor(rates, "w2", "j2")).toBeNull();
    expect(rateFor(rates, "w4", "j1")).toBeNull();
    expect(rateFor([], "w1", "j1")).toBeNull();
  });

  it("gives shop time the shop rate and never the usual rate", () => {
    expect(rateFor(rates, "w1", null)).toEqual({ rate: 15, from: "shop" });
    expect(rateFor(rates, "w3", null)).toBeNull();
    expect(rateFor(rates, "w2", null)).toBeNull();
  });

  it("is offered ahead of what they were last paid", () => {
    const pay: PayItem[] = [line({ workerId: "w1", jobId: "j1", rate: 22, date: "2026-11-20" })];
    expect(suggestRate(pay, "w1", "j1", rates)).toEqual({ rate: 30, from: "the rate list" });
    expect(suggestRate(pay, "w1", "j1")).toEqual({ rate: 22, from: "this job" });
    // No list rate for this person on this job: back to what they were last paid.
    expect(suggestRate([line({ workerId: "w2", jobId: "j2", rate: 12 })], "w2", "j2", rates)).toEqual({ rate: 12, from: "this job" });
  });

  it("can be started from the records: each job's latest rate that isn't on the list, and the last rates paid", () => {
    const pay: PayItem[] = [
      line({ workerId: "w2", jobId: "j1", rate: 10, date: "2026-11-10" }),
      line({ workerId: "w2", jobId: "j2", rate: 15, date: "2026-11-12" }),
      line({ workerId: "w2", jobId: "j2", rate: 20, date: "2026-11-14" }),
      line({ workerId: "w2", jobId: null, what: "Shop time", rate: 12, date: "2026-11-15" }),
      line({ workerId: "w2", jobId: null, what: "Trim", rate: 18, date: "2026-11-16" }),
      line({ workerId: "w2", jobId: "j3", rate: 0, date: "2026-11-17" }),
      line({ workerId: "w2", jobId: "j4", hours: null, rate: null, amount: 200, entryId: null, date: "2026-11-18" }),
      payment({ workerId: "w2" }),
    ];
    // j1 is already on the list for w2; tracked and flat lines don't suggest a rate.
    expect(seenJobRates(pay, rates, "w2")).toEqual([{ jobId: "j2", rate: 20, date: "2026-11-14" }]);
    expect(lastRates(pay, "w2")).toEqual({ work: { rate: 18, date: "2026-11-16" }, shop: { rate: 12, date: "2026-11-15" } });
    expect(lastRates(pay, "w9")).toEqual({ work: null, shop: null });
  });
});

describe("hours and how a payment was made", () => {
  it("adds up the hours on each person's pay lines", () => {
    const list = balances([line({ hours: 4, amount: 80 }), line({ hours: 3.5, amount: 70 }), line({ hours: null, rate: null, entryId: null, amount: 150 }), payment({ amount: 100 })]);
    expect(list[0]).toMatchObject({ hours: 7.5, earned: 300, paid: 100, owed: 200 });
  });

  it("reads how a payment was made, and leaves out anything it doesn't know", () => {
    expect(readMethod("PayPal")).toBe("paypal");
    expect(readMethod(" cash ")).toBe("cash");
    expect(readMethod("cheque")).toBe("check");
    expect(readMethod("other")).toBe("other");
    expect(readMethod("venmo")).toBeUndefined();
    expect(readMethod("")).toBeUndefined();
    expect(readMethod(undefined)).toBeUndefined();
    expect(methodLabel("paypal")).toBe("PayPal");
    expect(methodLabel(undefined)).toBe("");
  });
});
