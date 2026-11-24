import { describe, expect, it } from "vitest";
import { filledLabels, fillFromModel, fillFromRules, NOT_SURE_HEADING, pasteUserContent, stillNeeded } from "@/lib/domain/paste-fill";

const limits = { minHours: 0.5, maxHours: 12, maxDays: 30, maxCrew: 4, maxTotal: 50_000, maxDoneDaysAgo: 365 };
const options = { today: "2026-11-23", limits };

/** A full model answer with nothing in it; each test overrides what it needs. */
function answer(over: Record<string, unknown>) {
  return {
    customerName: "",
    phone: "",
    email: "",
    billingAddress: "",
    billingZip: "",
    jobSiteAddress: "",
    service: "other",
    title: "",
    details: "",
    price: null,
    travel: null,
    hours: null,
    days: null,
    people: null,
    workDone: "unknown",
    doneOn: "",
    whiteLabel: false,
    notSure: [],
    ...over,
  };
}

describe("fillFromModel", () => {
  it("fills the whole form from the owner's own note", () => {
    const note = "mary johnson 231-555-0142 mary.j@example.com, toilet clogged at 412 Pine St Cadillac MI 49601. snaked it today, $350, took about 2 hours";
    const got = fillFromModel(
      answer({
        customerName: "Mary Johnson",
        phone: "231-555-0142",
        email: "mary.j@example.com",
        billingAddress: "412 Pine St, Cadillac, MI",
        billingZip: "49601",
        service: "drain",
        title: "Clear clogged toilet",
        details: "Cleared a clogged toilet with a drain snake.",
        price: 350,
        hours: 2,
        workDone: "yes",
        doneOn: "2026-11-23",
      }),
      note,
      options,
    );
    expect(got).not.toBeNull();
    expect(got?.fullName).toBe("Mary Johnson");
    expect(got?.phone).toBe("231-555-0142");
    expect(got?.email).toBe("mary.j@example.com");
    expect(got?.billingAddress).toBe("412 Pine St, Cadillac, MI");
    expect(got?.billingZip).toBe("49601");
    expect(got?.service).toBe("drain");
    expect(got?.scope).toBe("Clear clogged toilet");
    expect(got?.details).toBe("Cleared a clogged toilet with a drain snake.");
    expect(got?.total).toBe("350");
    expect(got?.hours).toBe("2");
    expect(got?.done).toBe("done");
    expect(got?.doneOn).toBe("2026-11-23");
    expect(got?.unsure).toBe(0);
    expect(stillNeeded(got!)).toEqual([]);
  });

  it("never fills a price that isn't written in the note", () => {
    const got = fillFromModel(answer({ customerName: "Sam Ortega", title: "Hang a TV", details: "Hang a 65 inch TV.", price: 275 }), "Sam Ortega wants a 65 inch TV hung", options);
    expect(got?.total).toBe("");
    expect(got?.unsure).toBe(1);
    expect(got?.details).toBe(`Hang a 65 inch TV.\n\n${NOT_SURE_HEADING}\n- Price: $275? That number isn't in your note.`);
    expect(stillNeeded(got!)).toEqual(["phone", "price"]);
  });

  it("reads a price written with a comma or cents", () => {
    expect(fillFromModel(answer({ title: "Paint two rooms", price: 1200 }), "paint two rooms for $1,200", options)?.total).toBe("1200");
    expect(fillFromModel(answer({ title: "Paint two rooms", price: 349.5 }), "paint two rooms 349.50", options)?.total).toBe("349.5");
  });

  it("keeps travel only when it is in the note and no more than the price", () => {
    const note = "fix the gate, 400 total, 60 of that is travel";
    expect(fillFromModel(answer({ title: "Fix the gate", price: 400, travel: 60 }), note, options)?.travel).toBe("60");
    const wrong = fillFromModel(answer({ title: "Fix the gate", price: 400, travel: 75 }), note, options);
    expect(wrong?.travel).toBe("");
    expect(wrong?.details).toContain("- Travel: $75?");
  });

  it("drops a phone, email or ZIP the note doesn't contain and says so in Details", () => {
    const got = fillFromModel(
      answer({ customerName: "Lee Park", phone: "231-555-9999", email: "lee@example.com", billingAddress: "9 Oak Ave, Lake City", billingZip: "49651", title: "Fix two deck boards" }),
      "Lee Park, 9 Oak Ave Lake City, two loose deck boards. call 231 555 0111",
      options,
    );
    expect(got?.fullName).toBe("Lee Park");
    expect(got?.billingAddress).toBe("9 Oak Ave, Lake City");
    expect(got?.phone).toBe("");
    expect(got?.email).toBe("");
    expect(got?.billingZip).toBe("");
    expect(got?.unsure).toBe(3);
    expect(got?.details).toContain("- Phone: 231-555-9999?");
    expect(got?.details).toContain("- Email: lee@example.com?");
    expect(got?.details).toContain("- Billing ZIP: 49651? It isn't in your note.");
  });

  it("accepts a phone written with spaces, a leading 1, or no area code", () => {
    expect(fillFromModel(answer({ phone: "(231) 555-0111", title: "Job" }), "call 1 231 555 0111", options)?.phone).toBe("231-555-0111");
    expect(fillFromModel(answer({ phone: "555-0111", title: "Job" }), "call 555-0111", options)?.phone).toBe("555-0111");
  });

  it("won't fill a name or address the model expanded on its own", () => {
    const got = fillFromModel(
      answer({ customerName: "Dollar General", billingAddress: "1401 N Mitchell St, Cadillac, MI 49601", title: "Clear floor drain" }),
      "DG on mitchell, floor drain backed up",
      options,
    );
    expect(got?.fullName).toBe("");
    expect(got?.billingAddress).toBe("");
    expect(got?.details).toContain("- Customer name: Dollar General?");
    expect(got?.details).toContain("- Billing address: 1401 N Mitchell St, Cadillac, MI 49601?");
  });

  it("matches a name whatever the capitals, and takes the ZIP from the address", () => {
    const got = fillFromModel(answer({ customerName: "Tina Marsh", billingAddress: "412 Pine St, Cadillac, MI 49601", title: "Paint two bedrooms" }), "tina marsh\n412 pine st cadillac mi 49601\npaint 2 bedrooms", options);
    expect(got?.fullName).toBe("Tina Marsh");
    expect(got?.billingZip).toBe("49601");
  });

  it("puts a store's address in the job site when the customer is someone else", () => {
    const note = "Apex Facility Services, ap@apexfs.example, wants the mens room sink drain cleared at the store, 1650 S Mitchell St Cadillac 49601. white label. $250";
    const got = fillFromModel(
      answer({
        customerName: "Apex Facility Services",
        email: "ap@apexfs.example",
        jobSiteAddress: "1650 S Mitchell St, Cadillac, MI 49601",
        service: "drain",
        title: "Clear restroom sink drain",
        details: "Clear the men's room sink drain at the store.",
        price: 250,
        workDone: "no",
        whiteLabel: true,
      }),
      note,
      options,
    );
    expect(got?.billingAddress).toBe("");
    expect(got?.jobSiteAddress).toBe("1650 S Mitchell St, Cadillac, MI 49601");
    expect(got?.whiteLabel).toBe(true);
    expect(got?.done).toBe("schedule");
    expect(got?.total).toBe("250");
  });

  it("ticks white-label only when the note says the words", () => {
    const got = fillFromModel(answer({ title: "Clear sink drain", whiteLabel: true }), "store job for the maintenance company, clear sink drain", options);
    expect(got?.whiteLabel).toBe(false);
    expect(got?.details).toContain("- White-label job? Tick the box if it is.");
  });

  it("leaves the job site blank when it's the same as the billing address", () => {
    const got = fillFromModel(answer({ billingAddress: "88 Lake Rd, Manton MI", jobSiteAddress: "88 Lake Rd, Manton MI", title: "Hang a TV" }), "88 Lake Rd, Manton MI hang a tv", options);
    expect(got?.billingAddress).toBe("88 Lake Rd, Manton MI");
    expect(got?.jobSiteAddress).toBe("");
  });

  it("adds the model's own doubts to the bottom of Details", () => {
    const got = fillFromModel(
      answer({ customerName: "Mary", title: "Replace kitchen faucet", details: "Replace the kitchen faucet. Customer supplies the faucet.", notSure: ["Price: $350 or $530?", "  ", "Mary: the customer, or the store manager?"] }),
      "mary - kitchen faucet, she has the faucet. 350? or was it 530",
      options,
    );
    expect(got?.unsure).toBe(2);
    expect(got?.total).toBe("");
    expect(got?.details).toBe(
      `Replace the kitchen faucet. Customer supplies the faucet.\n\n${NOT_SURE_HEADING}\n- Price: $350 or $530?\n- Mary: the customer, or the store manager?`,
    );
  });

  it("checks hours, days and people against the form's limits", () => {
    const ok = fillFromModel(answer({ title: "Build a shed", hours: 7.75, days: 3, people: 2 }), "shed, 3 days, two guys, about 8 hours a day", options);
    expect(ok?.hours).toBe("8");
    expect(ok?.days).toBe("3");
    expect(ok?.crewSize).toBe("2");
    const bad = fillFromModel(answer({ title: "Build a shed", hours: 16, days: 0, people: 9 }), "shed", options);
    expect(bad?.hours).toBe("");
    expect(bad?.days).toBe("");
    expect(bad?.crewSize).toBe("");
    expect(bad?.unsure).toBe(3);
  });

  it("keeps a finished date only when it is a real day that isn't in the future", () => {
    expect(fillFromModel(answer({ title: "Fix door", workDone: "yes", doneOn: "2026-11-20" }), "fixed the door friday", options)?.doneOn).toBe("2026-11-20");
    const future = fillFromModel(answer({ title: "Fix door", workDone: "yes", doneOn: "2026-11-27" }), "fixed the door", options);
    expect(future?.done).toBe("done");
    expect(future?.doneOn).toBe("");
    expect(future?.details).toContain("- Date the work was done: 2026-11-27?");
    expect(fillFromModel(answer({ title: "Fix door", workDone: "yes", doneOn: "2026-02-30" }), "fixed the door", options)?.doneOn).toBe("");
    expect(fillFromModel(answer({ title: "Fix door", workDone: "unknown", doneOn: "2026-11-20" }), "fix the door", options)?.done).toBe("");
  });

  it("ignores a service that isn't on the list and a title that is too short", () => {
    const got = fillFromModel(answer({ service: "roofing", title: "ok", details: "Patch the roof." }), "patch the roof", options);
    expect(got?.service).toBe("");
    expect(got?.scope).toBe("");
    expect(got?.details).toBe("Patch the roof.");
  });

  it("returns null for an answer it can't use", () => {
    expect(fillFromModel(null, "note", options)).toBeNull();
    expect(fillFromModel("Mary, 231-555-0142", "note", options)).toBeNull();
    expect(fillFromModel([answer({ title: "Job" })], "note", options)).toBeNull();
    expect(fillFromModel(answer({}), "note", options)).toBeNull();
  });
});

describe("fillFromRules", () => {
  it("gives the built-in reader's answer in the same shape, with no title or price", () => {
    const got = fillFromRules("Sam Ortega\n231.555.0199\n88 Lake Rd, Manton MI 49663\nCan you hang a 65 inch TV over the fireplace? $300");
    expect(got.fullName).toBe("Sam Ortega");
    expect(got.phone).toBe("231-555-0199");
    expect(got.billingAddress).toBe("88 Lake Rd, Manton MI 49663");
    expect(got.billingZip).toBe("49663");
    expect(got.service).toBe("tv");
    expect(got.scope).toBe("");
    expect(got.total).toBe("");
    expect(got.unsure).toBe(0);
    expect(filledLabels(got)).toEqual(["name", "phone", "address", "ZIP", "service", "details"]);
    expect(stillNeeded(got)).toEqual(["title", "price"]);
  });
});

describe("pasteUserContent", () => {
  it("tells the model today's date and weekday ahead of the note", () => {
    expect(pasteUserContent("fixed it yesterday", "2026-11-23")).toBe("Today is 2026-11-23 (Monday).\n\nNote:\nfixed it yesterday");
  });
});
