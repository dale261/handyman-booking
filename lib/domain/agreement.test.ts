import { describe, expect, it } from "vitest";
import type { JobRecord, PaymentRecord } from "@/lib/db/types";
import { accepted, agreementTerms, canSign, invoiceSummary, invoiceTerms, licensingStatement, ownerPriceLines } from "@/lib/domain/agreement";
import { DEFAULT_SETTINGS } from "@/lib/domain/settings";
import { DEFAULT_PARAMS } from "@/lib/domain/types";

function job(over: Partial<JobRecord> = {}): JobRecord {
  const now = new Date().toISOString();
  return {
    id: "job-1",
    customerId: "cust-1",
    customerName: "Pat Customer",
    customerEmail: "pat@example.com",
    customerPhone: "231-555-0100",
    service: "other",
    description: "Replace the kitchen faucet with the one the customer bought.",
    params: { ...DEFAULT_PARAMS },
    billingAddress: "100 Main St, Cadillac, MI 49601",
    jobSiteAddress: "100 Main St, Cadillac, MI 49601",
    differentSite: false,
    jobZip: "49601",
    county: "Wexford",
    city: "Cadillac",
    areaAuto: true,
    areaLabel: "In our service area",
    areaDetail: "",
    jobLat: null,
    jobLng: null,
    zipMiles: 0,
    scope: "Replace kitchen faucet",
    lines: ownerPriceLines({ scope: "Replace kitchen faucet", total: 450, travel: 50 }),
    assumptions: [],
    total: 450,
    amountDueNow: 450,
    balanceDue: 0,
    payRule: "Jobs under $1,500 are paid in full to book.",
    licenseLevel: "ok",
    licenseTrade: "",
    licenseWhy: "",
    licenseRule: "",
    referralNote: "",
    urgent: false,
    pickup: false,
    photos: [],
    preferredWorkerId: null,
    crewId: null,
    workerIds: [],
    assignedBy: null,
    assignNote: "",
    scheduledDate: null,
    startMin: null,
    onsiteMinutes: 120,
    driveMinutes: 0,
    reserveStartMin: null,
    reserveEndMin: null,
    travelMiles: null,
    travelFrom: "",
    travelFee: 50,
    travelLocked: true,
    travelSource: "owner",
    status: "quoted",
    priorStatus: null,
    holdUntil: null,
    invoiceNumber: 1000,
    paypalOrderId: null,
    completionNote: "",
    problemNote: "",
    priceChanges: [],
    ownerPriced: true,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

function payment(over: Partial<PaymentRecord> = {}): PaymentRecord {
  return {
    id: over.id ?? "pay-1",
    jobId: "job-1",
    kind: "full",
    amount: 450,
    method: "cash",
    status: "paid",
    closed: false,
    note: "",
    paypalCaptureId: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe("owner price lines", () => {
  it("splits travel out of the total so the cancel-on-site rule has a number", () => {
    const lines = ownerPriceLines({ scope: "Replace kitchen faucet", total: 450, travel: 50 });
    expect(lines).toHaveLength(2);
    expect(lines[0].amount).toBe(400);
    expect(lines[0].kind).toBe("service");
    expect(lines[1].amount).toBe(50);
    expect(lines[1].kind).toBe("travel");
    expect(lines.reduce((sum, line) => sum + line.amount, 0)).toBe(450);
  });

  it("is one line when travel is zero, and never lets travel exceed the total", () => {
    expect(ownerPriceLines({ scope: "Hang a door", total: 300, travel: 0 })).toHaveLength(1);
    const capped = ownerPriceLines({ scope: "Hang a door", total: 300, travel: 900 });
    expect(capped[0].amount).toBe(0);
    expect(capped[1].amount).toBe(300);
  });
});

describe("invoice summary", () => {
  it("shows the booking amount due while held, and nothing after it is paid in full", () => {
    const held = invoiceSummary(job({ status: "held" }), []);
    expect(held.dueNow).toBe(450);
    expect(held.balance).toBe(450);
    expect(held.dueLabel).toContain("450");
    const booked = invoiceSummary(job({ status: "booked", amountDueNow: 0 }), [payment()]);
    expect(booked.paid).toBe(450);
    expect(booked.balance).toBe(0);
    expect(booked.dueNow).toBe(0);
  });

  it("nets refunds and ignores closed payments", () => {
    const summary = invoiceSummary(job({ status: "cancelled" }), [
      payment(),
      payment({ id: "r1", kind: "refund", amount: 400, status: "sent" }),
      payment({ id: "old", amount: 999, closed: true }),
    ]);
    expect(summary.paid).toBe(50);
    expect(summary.refunded).toBe(400);
    expect(summary.dueLabel).toContain("cancelled");
  });

  it("asks for the balance after approval on a half-down job", () => {
    const summary = invoiceSummary(job({ status: "balance_due", total: 2000, amountDueNow: 0, balanceDue: 1000 }), [payment({ kind: "deposit", amount: 1000 })]);
    expect(summary.dueNow).toBe(1000);
    expect(summary.balance).toBe(1000);
  });
});

describe("agreement wording", () => {
  it("only lets a firm, live job be signed", () => {
    expect(canSign("quoted")).toBe(true);
    expect(canSign("booked")).toBe(true);
    expect(canSign("scope_review")).toBe(false);
    expect(canSign("cancelled")).toBe(false);
  });

  it("counts a paid deposit as acceptance when nothing is signed", () => {
    expect(accepted(job(), [])).toBe(false);
    expect(accepted(job(), [payment()])).toBe(true);
    expect(accepted(job({ agreement: { signedName: "Pat Customer", signedAt: new Date().toISOString(), total: 450, ip: "", userAgent: "" } }), [])).toBe(true);
  });

  it("states the license when there is one, the exemption when under $600, and a licensed contractor otherwise", () => {
    const base = { businessName: "eX Construction LC", builderThreshold: 600 };
    expect(licensingStatement({ ...base, licenseNumber: "2101234567" }, 450).join(" ")).toContain("license number 2101234567");
    expect(licensingStatement({ ...base, licenseNumber: "" }, 450).join(" ")).toContain("no builder license is required");
    expect(licensingStatement({ ...base, licenseNumber: "" }, 600).join(" ")).toContain("a licensed contractor does the licensed part");
    expect(licensingStatement({ ...base, licenseNumber: "" }, 600).join(" ")).not.toContain("no builder license is required");
    const drain = licensingStatement({ ...base, licenseNumber: "" }, 250, false, "drain").join(" ");
    expect(drain).toContain("make no changes to the plumbing");
    expect(drain).not.toContain("Electrical, plumbing, and heating or cooling work must be done");
    const bigDrain = licensingStatement({ ...base, licenseNumber: "" }, 600, false, "drain").join(" ");
    expect(bigDrain).not.toContain("a licensed contractor does the licensed part");
    // A larger drain job says nothing about a builder license at all.
    expect(bigDrain).not.toContain("That rule does not apply to this kind of work");
    expect(bigDrain).not.toContain("residential builder");
    const bigPaint = licensingStatement({ ...base, licenseNumber: "" }, 900, false, "paint", false).join(" ");
    expect(bigPaint).toContain("That rule does not apply to this kind of work, so no builder license is required for it.");
    expect(bigPaint).not.toContain("a licensed contractor does the licensed part");
    // Under the amount, the plain sentence stays, whatever kind of work it is.
    expect(licensingStatement({ ...base, licenseNumber: "" }, 450, false, "paint", false).join(" ")).toContain("This job is under that amount");
    expect(bigDrain).toContain("make no changes to the plumbing");
    expect(licensingStatement({ ...base, licenseNumber: "2101234567" }, 600, false, "drain").join(" ")).toContain("license number 2101234567");
    expect(licensingStatement({ ...base, licenseNumber: "" }, 250, false, "tv").join(" ")).toContain("Electrical, plumbing, and heating or cooling work must be done");
  });

  it("builds terms from the real rules and the owner's own clauses", () => {
    const settings = { ...DEFAULT_SETTINGS, warrantyText: "Thirty days on our workmanship.", extraTerms: "Pets stay in another room.\n\nWe park in the driveway." };
    const terms = agreementTerms(job(), settings);
    const text = terms.map((section) => `${section.title} ${section.body.join(" ")}`).join("\n");
    expect(text).toContain("$50.00");
    expect(text).toContain("24 hours");
    expect(text).toContain("Travel is included.");
    expect(text).toContain("except $50.00 for travel");
    expect(text).toContain("Thirty days on our workmanship.");
    expect(terms.find((section) => section.title === "Other terms")?.body).toEqual(["Pets stay in another room.", "We park in the driveway."]);
    expect(text).toContain("This job is paid in full to book: $450.00.");
    expect(text).not.toContain("Jobs under");
    expect(text).not.toContain("Dale");
  });

  it("explains half down on a bigger job and leaves optional clauses out when blank", () => {
    const terms = agreementTerms(job({ total: 2000, amountDueNow: 1000, balanceDue: 1000, travelFee: 0, lines: ownerPriceLines({ scope: "Deck boards", total: 2000, travel: 0 }) }), DEFAULT_SETTINGS);
    const text = terms.map((section) => section.body.join(" ")).join("\n");
    expect(text).toContain("half down to book: $1,000.00 to book and $1,000.00 when the work is finished");
    expect(text).toContain("refund everything you paid.");
    expect(terms.some((section) => section.title === "Our workmanship promise")).toBe(false);
    expect(terms.some((section) => section.title === "Other terms")).toBe(false);
  });
});

describe("white-label jobs", () => {
  const wl = { by: "customer" as const, at: "2026-11-21T12:00:00.000Z" };

  it("says photos may be posted on a normal agreement, and not on a white-label one", () => {
    const normal = agreementTerms(job(), DEFAULT_SETTINGS);
    const normalText = normal.flatMap((section) => section.body).join(" ");
    expect(normalText).toContain("We may post them on our website and social media");
    expect(normal.some((section) => section.title === "White-label service")).toBe(false);

    const marked = agreementTerms(job({ whiteLabel: wl }), DEFAULT_SETTINGS);
    const markedText = marked.flatMap((section) => section.body).join(" ");
    expect(marked[1].title).toBe("White-label service");
    expect(markedText).toContain("we work as your company's technician");
    expect(markedText).toContain("We never post them.");
    expect(markedText).not.toContain("We may post them");
  });

  it("carries the same choice onto an invoice for finished work", () => {
    const done = { workDoneOn: "2026-11-19", status: "balance_due" as const };
    const normal = invoiceTerms(job(done), DEFAULT_SETTINGS);
    expect(normal.find((section) => section.title === "Photos")?.body.join(" ")).toContain("We may post photos of this work");

    const marked = invoiceTerms(job({ ...done, whiteLabel: wl }), DEFAULT_SETTINGS);
    expect(marked.some((section) => section.title === "Photos")).toBe(false);
    const text = marked.find((section) => section.title === "White-label service")?.body.join(" ") ?? "";
    expect(text).toContain("we worked as your company's technician");
    expect(text).toContain("We never post them.");
  });
});
