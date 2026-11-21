import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalRepository } from "@/lib/db/local";
import { parseDraft, type QuoteDraft } from "@/lib/domain/draft";
import { DEFAULT_SETTINGS } from "@/lib/domain/settings";
import { publicEstimate } from "@/lib/services/estimate";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-drain-"));
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

describe("drain clearing on the public price page", () => {
  it("charges no travel for a drain job in Cadillac and books without review", async () => {
    const result = await publicEstimate(
      repo(),
      draft({ service: "drain", params: { drainKind: "trap", drains: 1 }, zip: "49601", description: "Kitchen sink is backed up and drains slowly" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.review).toBe(false);
    expect(result.data.total).toBe(DEFAULT_SETTINGS.drainTrap);
    const travel = result.data.lines.find((line) => line.kind === "travel");
    expect(travel?.amount).toBe(0);
    expect(travel?.detail).toBe("No travel charge for drain clearing in Cadillac");
    expect(result.data.assumptions.some((note) => note.includes("from our shop to this address"))).toBe(false);
  });

  it("prices a toilet that has to be removed and reset", async () => {
    const result = await publicEstimate(
      repo(),
      draft({ service: "drain", params: { drainKind: "toilet", drains: 1, drainPull: true }, zip: "49601", description: "Toilet is clogged, may need to remove the toilet" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.review).toBe(false);
    expect(result.data.total).toBe(DEFAULT_SETTINGS.drainToilet + DEFAULT_SETTINGS.drainToiletPull);
  });

  it("still charges travel for a drain job outside Cadillac", async () => {
    const result = await publicEstimate(
      repo(),
      draft({ service: "drain", params: { drainKind: "main" }, zip: "49651", address: "5 Main St, Lake City, MI", description: "Sewer line backed up at the cleanout" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.review).toBe(false);
    const travel = result.data.lines.find((line) => line.kind === "travel");
    expect(travel?.amount).toBeGreaterThanOrEqual(DEFAULT_SETTINGS.travelMinimum);
    expect(result.data.total).toBe(DEFAULT_SETTINGS.drainMain + (travel?.amount ?? 0));
  });

  it("still charges travel for other jobs in Cadillac", async () => {
    const result = await publicEstimate(
      repo(),
      draft({ service: "tv", params: { tvSize: "55", wall: "drywall", conceal: "none" }, zip: "49601", description: "Mount a 55-inch TV on a drywall wall" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(DEFAULT_SETTINGS.tvSmall + DEFAULT_SETTINGS.travelMinimum);
  });

  it("sends a drain job to review when the words ask for plumbing repairs", async () => {
    const result = await publicEstimate(
      repo(),
      draft({ service: "drain", params: { drainKind: "trap" }, zip: "49601", description: "Clogged drain and the pipe under the sink is leaking, replace it" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.review).toBe(true);
  });
});
