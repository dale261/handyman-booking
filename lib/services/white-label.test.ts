import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser } from "@/lib/db/types";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { ensureDocToken, setWhiteLabel } from "@/lib/services/agreement";
import { createQuote } from "@/lib/services/booking";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-white-label-"));
  dirs.push(dir);
  return new LocalRepository(dir);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function actor(store: LocalRepository, id: string) {
  const user = await store.getUser(id);
  if (!user) throw new Error("missing demo user");
  return actorFromUser(user);
}

async function quotedJob(store: LocalRepository) {
  const customer = await actor(store, DEMO_USERS.customer);
  const created = await createQuote(store, customer, {
    service: "tv",
    description: "Mount a 55-inch TV on a drywall wall",
    params: { ...DEFAULT_PARAMS, tvSize: "55", wall: "drywall", conceal: "none" },
    differentSite: false,
    jobSiteAddress: "",
    urgent: false,
    pickup: false,
    preferredWorkerId: null,
    photos: [],
  });
  if (!created.ok) throw new Error(created.error);
  return { customer, job: created.data };
}

describe("white-label choice", () => {
  it("starts off, and the customer can turn it on and back off", async () => {
    const store = repo();
    const { customer, job } = await quotedJob(store);
    expect(job.whiteLabel ?? null).toBeNull();

    const on = await setWhiteLabel(store, { jobId: job.id, actor: customer, token: null, on: true });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(on.data.whiteLabel?.by).toBe("customer");

    const off = await setWhiteLabel(store, { jobId: job.id, actor: customer, token: null, on: false });
    expect(off.ok).toBe(true);
    if (!off.ok) return;
    expect(off.data.whiteLabel ?? null).toBeNull();
  });

  it("lets someone holding the job's link choose it, and refuses a wrong link", async () => {
    const store = repo();
    const { job } = await quotedJob(store);
    const withLink = await ensureDocToken(store, job);

    const wrong = await setWhiteLabel(store, { jobId: job.id, actor: null, token: "not-the-link", on: true });
    expect(wrong.ok).toBe(false);

    const right = await setWhiteLabel(store, { jobId: job.id, actor: null, token: withLink.docToken ?? "", on: true });
    expect(right.ok).toBe(true);
    if (!right.ok) return;
    expect(right.data.whiteLabel?.by).toBe("customer");
  });

  it("does not let the owner undo a choice the customer made", async () => {
    const store = repo();
    const { customer, job } = await quotedJob(store);
    const owner = await actor(store, DEMO_USERS.owner);
    await setWhiteLabel(store, { jobId: job.id, actor: customer, token: null, on: true });

    const undo = await setWhiteLabel(store, { jobId: job.id, actor: owner, token: null, on: false });
    expect(undo.ok).toBe(false);
    const still = await store.getJob(job.id);
    expect(still?.whiteLabel?.by).toBe("customer");
  });

  it("lets the owner turn it on and off for a job they marked themselves", async () => {
    const store = repo();
    const { job } = await quotedJob(store);
    const owner = await actor(store, DEMO_USERS.owner);

    const on = await setWhiteLabel(store, { jobId: job.id, actor: owner, token: null, on: true });
    expect(on.ok).toBe(true);
    if (!on.ok) return;
    expect(on.data.whiteLabel?.by).toBe("owner");

    const off = await setWhiteLabel(store, { jobId: job.id, actor: owner, token: null, on: false });
    expect(off.ok).toBe(true);
  });

  it("refuses a worker and a different customer", async () => {
    const store = repo();
    const { job } = await quotedJob(store);
    const worker = await actor(store, DEMO_USERS.worker);
    const refused = await setWhiteLabel(store, { jobId: job.id, actor: worker, token: null, on: true });
    expect(refused.ok).toBe(false);
    const still = await store.getJob(job.id);
    expect(still?.whiteLabel ?? null).toBeNull();
  });

  it("tells the owner when a customer turns it on", async () => {
    const store = repo();
    const { customer, job } = await quotedJob(store);
    await setWhiteLabel(store, { jobId: job.id, actor: customer, token: null, on: true });
    const notes = await store.listNotifications();
    expect(notes.some((note) => note.title.startsWith("White-label turned on"))).toBe(true);
  });
});
