import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { createQuote } from "@/lib/services/booking";
import { jobSiteAddress, parseDraft, type QuoteDraft } from "@/lib/domain/draft";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { DEFAULT_SETTINGS } from "@/lib/domain/settings";
import { publicEstimate, recentLeadForPhone, recordLead } from "@/lib/services/estimate";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-estimate-"));
  dirs.push(dir);
  return new LocalRepository(dir);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function draft(input: Record<string, unknown>): QuoteDraft {
  const parsed = parseDraft({ fullName: "Pat Tester", phone: "231-555-0100", address: "101 Example Ave, Cadillac, MI", ...input });
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.draft;
}

describe("public price before sign-up", () => {
  it("prices a TV mount in Cadillac from the rate sheet with minimum travel", async () => {
    const store = repo();
    const result = await publicEstimate(
      store,
      draft({ service: "tv", params: { tvSize: "55", wall: "drywall", conceal: "none" }, zip: "49601", description: "Mount a 55-inch TV on a drywall wall" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.review).toBe(false);
    expect(result.data.area.known).toBe(true);
    expect(result.data.area.auto).toBe(true);
    expect(result.data.total).toBe(DEFAULT_SETTINGS.tvSmall + DEFAULT_SETTINGS.travelMinimum);
    expect(result.data.dueNow).toBe(result.data.total);
    expect(result.data.balance).toBe(0);
    const travel = result.data.lines.find((line) => line.kind === "travel");
    expect(travel?.amount).toBe(DEFAULT_SETTINGS.travelMinimum);
    expect(travel?.detail).toContain("estimated");
    expect(result.data.assumptions.some((note) => note.includes("from our shop to this address"))).toBe(true);
    expect(result.data.lines.some((line) => line.kind === "premium")).toBe(false);
  });

  it("adds the area charge in a premium county", async () => {
    const store = repo();
    const result = await publicEstimate(
      store,
      draft({ service: "furniture", params: { items: 2, itemKind: "medium" }, zip: "49637", description: "Assemble a desk and a dresser" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.area.county).toBe("Grand Traverse");
    const premium = result.data.lines.find((line) => line.kind === "premium");
    expect(premium?.amount).toBeCloseTo(2 * DEFAULT_SETTINGS.asmMedium * (DEFAULT_SETTINGS.premiumMultiplier - 1), 2);
  });

  it("shows no price when Dale has to look first", async () => {
    const store = repo();
    const lead = await publicEstimate(
      store,
      draft({ service: "paint", params: { rooms: 2, sqft: 300, pre1978: true }, zip: "49601", description: "Repaint two bedrooms in our 1955 farmhouse" }),
    );
    expect(lead.ok).toBe(true);
    if (!lead.ok) return;
    expect(lead.data.review).toBe(true);
    expect(lead.data.lines).toHaveLength(0);
    expect(lead.data.total).toBe(0);
    expect(lead.data.reviewNote).toMatch(/one firm price/);

    const power = await publicEstimate(
      store,
      draft({ service: "tv", params: { conceal: "power" }, zip: "49601", description: "Mount the TV and add a new outlet behind it" }),
    );
    expect(power.ok).toBe(true);
    if (!power.ok) return;
    expect(power.data.review).toBe(true);
    expect(power.data.total).toBe(0);
  });

  it("still prices a ZIP outside the table, with travel to be measured", async () => {
    const store = repo();
    const result = await publicEstimate(
      store,
      draft({ service: "clean", params: { hours: 3 }, zip: "48201", description: "Routine clean of a two-bedroom apartment" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.review).toBe(false);
    expect(result.data.area.known).toBe(false);
    expect(result.data.area.auto).toBe(false);
    const travel = result.data.lines.find((line) => line.kind === "travel");
    expect(travel?.amount).toBe(DEFAULT_SETTINGS.travelMinimum);
    expect(travel?.detail).toMatch(/until we measure/);
    expect(result.data.assumptions.some((note) => note.includes("from our shop to this address"))).toBe(false);
  });

  it("splits a large job into half down", async () => {
    const store = repo();
    const result = await publicEstimate(
      store,
      draft({
        service: "paint",
        params: { rooms: 5, sqft: 1400, height: "9", cond: "fair", doors: 10, colors: 3 },
        zip: "49601",
        description: "Repaint the living room, dining room, hallway and two bedrooms",
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.depositThreshold);
    expect(result.data.dueNow + result.data.balance).toBeCloseTo(result.data.total, 2);
    expect(result.data.balance).toBeGreaterThan(0);
  });

  it("saves the lead on the first check, tells Dale once, and updates the same phone later", async () => {
    const store = repo();
    const first = draft({ service: "tv", params: { tvSize: "55" }, zip: "49601", description: "Mount a 55-inch TV on a drywall wall", email: "pat@example.com" });
    const priced = await publicEstimate(store, first);
    if (!priced.ok) throw new Error(priced.error);
    const lead = await recordLead(store, first, priced.data);
    expect(lead.jobId).toBeNull();
    expect(lead.total).toBe(priced.data.total);
    expect(lead.review).toBe(false);

    const notes = await store.listNotifications();
    const note = notes.find((item) => item.kind === "lead");
    expect(note?.title).toContain("Pat Tester");
    expect(note?.title).toContain("TV mounting");
    expect(note?.detail).toContain("231-555-0100");
    expect(note?.detail).toContain("pat@example.com");
    const ownerMail = (await store.listEmails()).find((email) => email.subject.startsWith("New lead"));
    expect(ownerMail?.to).toBe("dale.orvis@exconstruction.example");

    const second = draft({ service: "furniture", params: { items: 3 }, zip: "49637", description: "Assemble three dressers", phone: "(231) 555-0100" });
    const repriced = await publicEstimate(store, second);
    if (!repriced.ok) throw new Error(repriced.error);
    const again = await recordLead(store, second, repriced.data);
    expect(again.id).toBe(lead.id);
    expect(again.service).toBe("furniture");
    expect(again.total).toBe(repriced.data.total);
    expect((await store.listLeads())).toHaveLength(1);
    expect((await store.listNotifications()).filter((item) => item.kind === "lead")).toHaveLength(1);

    const reviewed = draft({ service: "paint", params: { pre1978: true }, zip: "49601", description: "Repaint the 1950s kitchen", phone: "231-555-0199" });
    const looked = await publicEstimate(store, reviewed);
    if (!looked.ok) throw new Error(looked.error);
    const other = await recordLead(store, reviewed, looked.data);
    expect(other.id).not.toBe(lead.id);
    expect(other.review).toBe(true);
    expect(other.total).toBeNull();
    expect((await store.listLeads())).toHaveLength(2);
  });

  it("shows the same price the job page shows after sign-up", async () => {
    const store = repo();
    const asked = draft({
      service: "furniture",
      params: { items: 2, itemKind: "large" },
      address: "12 Lake St, Glen Arbor, MI",
      zip: "49636",
      description: "Assemble a wardrobe and a sectional",
      urgent: true,
    });
    const shown = await publicEstimate(store, asked);
    if (!shown.ok) throw new Error(shown.error);
    const user = await store.getUser(DEMO_USERS.customer);
    if (!user) throw new Error("missing demo customer");
    const booked = await createQuote(store, actorFromUser(user), {
      service: asked.service,
      description: asked.description,
      params: { ...DEFAULT_PARAMS, ...asked.params },
      differentSite: true,
      jobSiteAddress: jobSiteAddress(asked),
      urgent: asked.urgent,
      pickup: asked.pickup,
      preferredWorkerId: null,
      photos: [],
    });
    if (!booked.ok) throw new Error(booked.error);
    expect(booked.data.total).toBe(shown.data.total);
    expect(booked.data.lines.map((line) => [line.label, line.amount])).toEqual(shown.data.lines.map((line) => [line.label, line.amount]));
    expect(booked.data.jobZip).toBe("49636");
    expect(await recentLeadForPhone(store, asked.phone)).toBeNull();
  });
});
