import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEMO_USERS, LocalRepository } from "@/lib/db/local";
import { actorFromUser, type UserRecord } from "@/lib/db/types";
import type { CrewInvite } from "@/lib/invites";
import { joinCrew, type MakeLogin } from "@/lib/services/crew-join";

const dirs: string[] = [];

function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ex-join-"));
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

/** Stands in for the real sign-in maker: saves the account the way the saved-file demo does. */
function loginMaker(store: LocalRepository, made: string[] = []): MakeLogin {
  return async (worker, password, phone) => {
    made.push(password);
    const user: UserRecord = { id: randomUUID(), role: "worker", email: worker.email, fullName: worker.fullName, phone, billingAddress: "", billingZip: "", passwordHash: "hash", workerId: worker.id };
    await store.saveUser(user);
    return user;
  };
}

async function invited(store: LocalRepository, over: Partial<CrewInvite> = {}): Promise<CrewInvite> {
  const crew = (await store.listCrews())[0];
  return { id: randomUUID(), crewId: crew.id, email: "", phone: "2315550123", expires: Date.now() + 60_000, ...over };
}

const lexi = { fullName: "  Lexi ", email: "Lexi@Example.com", password: "paint-and-caulk" };

describe("joining from an invite", () => {
  it("makes the crew member with their own details, on the crew the owner picked, and tells the owner", async () => {
    const store = repo();
    const invite = await invited(store);
    const before = (await store.listNotifications()).length;
    const made: string[] = [];
    const joined = await joinCrew(store, invite, lexi, null, loginMaker(store, made));
    if (!joined.ok) throw new Error(joined.error);
    expect(joined.newLogin).toBe(true);
    expect(joined.worker).toMatchObject({ id: invite.id, fullName: "Lexi", email: "lexi@example.com", crewId: invite.crewId, active: true });
    expect(joined.user).toMatchObject({ role: "worker", email: "lexi@example.com", phone: "2315550123", workerId: invite.id });
    expect(made).toEqual(["paint-and-caulk"]);
    expect((await store.listWorkers()).some((worker) => worker.id === invite.id)).toBe(true);
    const notes = await store.listNotifications();
    expect(notes.length).toBe(before + 1);
    expect(notes.some((note) => note.title === "Lexi joined the crew")).toBe(true);
  });

  it("works only once", async () => {
    const store = repo();
    const invite = await invited(store);
    expect((await joinCrew(store, invite, lexi, null, loginMaker(store))).ok).toBe(true);
    const again = await joinCrew(store, invite, { fullName: "Someone Else", email: "else@example.com", password: "another-pass" }, null, loginMaker(store));
    expect(again.ok).toBe(false);
    expect((await store.listWorkers()).filter((worker) => worker.email === "else@example.com")).toHaveLength(0);
  });

  it("asks for a real name, a real email and a password of 8 or more", async () => {
    const store = repo();
    const invite = await invited(store);
    const count = (await store.listWorkers()).length;
    expect((await joinCrew(store, invite, { ...lexi, fullName: " " }, null, loginMaker(store))).ok).toBe(false);
    expect((await joinCrew(store, invite, { ...lexi, email: "lexi" }, null, loginMaker(store))).ok).toBe(false);
    expect((await joinCrew(store, invite, { ...lexi, email: "%@example.com" }, null, loginMaker(store))).ok).toBe(false);
    expect((await joinCrew(store, invite, { ...lexi, password: "short" }, null, loginMaker(store))).ok).toBe(false);
    expect((await store.listWorkers()).length).toBe(count);
  });

  it("can't be used to take over an account that already exists", async () => {
    const store = repo();
    const invite = await invited(store);
    const customer = await store.getUser(DEMO_USERS.customer);
    const owner = await store.getUser(DEMO_USERS.owner);
    if (!customer || !owner) throw new Error("missing demo users");
    const made: string[] = [];
    // Not signed in, typing a customer's email: refused, and no password is set for it.
    const taken = await joinCrew(store, invite, { ...lexi, email: customer.email }, null, loginMaker(store, made));
    expect(taken.ok).toBe(false);
    expect((await joinCrew(store, invite, { ...lexi, email: owner.email }, null, loginMaker(store, made))).ok).toBe(false);
    expect(made).toEqual([]);
    expect((await store.getUser(customer.id))?.role).toBe("customer");
    expect((await store.listWorkers()).some((worker) => worker.id === invite.id)).toBe(false);
  });

  it("lets someone who is signed in join with the account they already have, password untouched", async () => {
    const store = repo();
    const invite = await invited(store);
    const customer = await actor(store, DEMO_USERS.customer);
    const before = await store.getUser(customer.id);
    const made: string[] = [];
    // The email typed on the form is ignored: the signed-in account's email is used.
    const joined = await joinCrew(store, invite, { fullName: "Lexi", email: "someone-else@example.com", password: "" }, customer, loginMaker(store, made));
    if (!joined.ok) throw new Error(joined.error);
    expect(joined.newLogin).toBe(false);
    expect(made).toEqual([]);
    const after = await store.getUser(customer.id);
    expect(after).toMatchObject({ role: "worker", workerId: invite.id, email: before?.email, passwordHash: before?.passwordHash });
  });

  it("refuses the owner and anyone already on the crew", async () => {
    const store = repo();
    const invite = await invited(store);
    const owner = await actor(store, DEMO_USERS.owner);
    const worker = await actor(store, DEMO_USERS.worker);
    expect((await joinCrew(store, invite, lexi, owner, loginMaker(store))).ok).toBe(false);
    expect((await joinCrew(store, invite, lexi, worker, loginMaker(store))).ok).toBe(false);
    const onList = (await store.listWorkers())[0];
    expect((await joinCrew(store, invite, { ...lexi, email: onList.email }, null, loginMaker(store))).ok).toBe(false);
  });

  it("leaves nothing behind when the sign-in can't be made", async () => {
    const store = repo();
    const invite = await invited(store);
    const broken: MakeLogin = async () => {
      throw new Error("sign-in service is down");
    };
    const joined = await joinCrew(store, invite, lexi, null, broken);
    expect(joined.ok).toBe(false);
    expect((await store.listWorkers()).some((worker) => worker.id === invite.id)).toBe(false);
    // The same link still works once the problem clears.
    expect((await joinCrew(store, invite, lexi, null, loginMaker(store))).ok).toBe(true);
  });

  it("joins with no crew when the invite had none, or its crew is gone", async () => {
    const store = repo();
    const none = await joinCrew(store, await invited(store, { crewId: null }), lexi, null, loginMaker(store));
    if (!none.ok) throw new Error(none.error);
    expect(none.worker.crewId).toBe(null);
    const gone = await joinCrew(store, await invited(store, { crewId: randomUUID() }), { ...lexi, email: "dan@example.com", fullName: "Dan" }, null, loginMaker(store));
    if (!gone.ok) throw new Error(gone.error);
    expect(gone.worker.crewId).toBe(null);
  });
});
