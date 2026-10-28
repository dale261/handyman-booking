import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-limits-"));
  dirs.push(dir);
  return new LocalRepository(dir);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("AI usage and IP limits", () => {
  it("allows calls up to the daily cap, then denies, and keeps customers independent until that cap", async () => {
    const store = repo();
    const settings = await store.getSettings();
    await store.saveSettings({ ...settings, aiDailyCap: 2, aiCustomerDailyCap: 10 });
    const day = "2026-10-27";
    const first = await store.reserveAiCall(DEMO_USERS.customer, day);
    const second = await store.reserveAiCall(DEMO_USERS.owner, day);
    const third = await store.reserveAiCall(DEMO_USERS.customer, day);
    expect(first.allowed).toBe(true);
    expect(second.allowed).toBe(true);
    expect(third.allowed).toBe(false);
    expect(third.total).toBe(2);
    const usage = await store.aiUsageForDay(day);
    expect(usage).toHaveLength(2);
    expect(usage.reduce((sum, row) => sum + row.calls, 0)).toBe(2);
  });

  it("stops one customer at the per-customer cap without blocking the next customer", async () => {
    const store = repo();
    const settings = await store.getSettings();
    await store.saveSettings({ ...settings, aiDailyCap: 100, aiCustomerDailyCap: 1 });
    const day = "2026-10-27";
    expect((await store.reserveAiCall(DEMO_USERS.customer, day)).allowed).toBe(true);
    const blocked = await store.reserveAiCall(DEMO_USERS.customer, day);
    expect(blocked.allowed).toBe(false);
    expect(blocked.customerCalls).toBe(1);
    expect((await store.reserveAiCall(DEMO_USERS.owner, day)).allowed).toBe(true);
  });

  it("does not increment when the cap is zero", async () => {
    const store = repo();
    const settings = await store.getSettings();
    await store.saveSettings({ ...settings, aiDailyCap: 0, aiCustomerDailyCap: 10 });
    const denied = await store.reserveAiCall(DEMO_USERS.customer, "2026-10-27");
    expect(denied.allowed).toBe(false);
    expect(await store.aiUsageForDay("2026-10-27")).toEqual([]);
  });

  it("blocks an IP after the max and leaves a different IP alone", async () => {
    const store = repo();
    expect((await store.hitRateLimit("anon", "203.0.113.8", 2, 60_000)).allowed).toBe(true);
    expect((await store.hitRateLimit("anon", "203.0.113.8", 2, 60_000)).allowed).toBe(true);
    const blocked = await store.hitRateLimit("anon", "203.0.113.8", 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.hits).toBe(2);
    expect((await store.hitRateLimit("anon", "198.51.100.4", 2, 60_000)).allowed).toBe(true);
    expect((await store.hitRateLimit("quote", "203.0.113.8", 2, 60_000)).allowed).toBe(true);
  });

  it("reads a saved file that has no usage tables yet", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-limits-"));
    dirs.push(dir);
    fs.writeFileSync(path.join(dir, "db.json"), JSON.stringify({ settings: {}, jobs: [] }));
    const store = new LocalRepository(dir);
    expect(await store.aiUsageForDay("2026-10-27")).toEqual([]);
    const reserved = await store.reserveAiCall(DEMO_USERS.customer, "2026-10-27");
    expect(reserved.allowed).toBe(true);
    expect(reserved.dailyCap).toBe(100);
    expect(reserved.customerCap).toBe(10);
  });
});
