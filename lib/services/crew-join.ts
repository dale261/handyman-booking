import type { Repository } from "@/lib/db/repository";
import type { Actor, UserRecord, WorkerRecord } from "@/lib/db/types";
import type { CrewInvite } from "@/lib/invites";
import { notify } from "@/lib/services/booking";

export const JOIN_LIMITS = { nameMin: 2, nameMax: 60, passwordMin: 8, passwordMax: 200 };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

/**
 * Makes the sign-in for a brand-new crew member and returns their account.
 * Given by the caller, because the live site makes it in Supabase and the
 * saved-file demo makes it in its own file.
 */
export type MakeLogin = (worker: WorkerRecord, password: string, phone: string) => Promise<UserRecord>;

export type JoinResult = { ok: true; worker: WorkerRecord; user: UserRecord; newLogin: boolean } | Err;

/**
 * Someone opened a crew invite and filled in their own details.
 *
 * - The invite works once: the crew member takes the invite's id.
 * - An email that already has an account can't be taken over from this form. That
 *   person signs in first and joins with the account they already have.
 * - The owner hears about every join, so a link that reached the wrong person is caught.
 */
export async function joinCrew(
  repo: Repository,
  invite: CrewInvite,
  details: { fullName: string; email: string; password: string },
  actor: Actor | null,
  makeLogin: MakeLogin,
): Promise<JoinResult> {
  if (actor?.role === "owner") return fail("You're signed in as the owner. Open this link on the crew member's own phone, or sign out first.");
  if (actor?.workerId) return fail("You're already on the crew. Open your crew page.");

  const fullName = details.fullName.replace(/\s+/g, " ").trim();
  if (fullName.length < JOIN_LIMITS.nameMin) return fail("Type your name.");
  if (fullName.length > JOIN_LIMITS.nameMax) return fail("That name is too long. A first name is fine.");

  // Signed in already: they join with that account, and its email. No password is touched.
  const email = (actor ? actor.email : details.email).trim().toLowerCase();
  // % and \ would act as wildcards in the account lookup, and no real address needs them.
  if (!EMAIL.test(email) || email.length > 200 || /[%\\]/.test(email)) return fail("That email doesn't look right. Check it and try again.");
  if (!actor && (details.password.length < JOIN_LIMITS.passwordMin || details.password.length > JOIN_LIMITS.passwordMax)) {
    return fail(`Choose a password with at least ${JOIN_LIMITS.passwordMin} characters.`);
  }

  const workers = await repo.listWorkers();
  if (workers.some((worker) => worker.id === invite.id)) return fail("This invite has already been used. If that was you, just sign in. If not, ask for a new invite.");
  if (workers.some((worker) => worker.email.toLowerCase() === email)) return fail("That email is already on the crew list. Sign in with it, or ask the owner to check.");

  const existing = await repo.getUserByEmail(email);
  if (existing?.role === "owner") return fail("That is the owner's email. Use your own.");
  if (existing && existing.id !== actor?.id) {
    return fail("That email already has an account here. Sign in with it first, then open your invite link again.");
  }

  const crews = await repo.listCrews();
  const crew = invite.crewId ? crews.find((item) => item.id === invite.crewId && item.active) : undefined;

  // The same starting hours the owner's own "Add worker" form gives: Monday to Saturday, 8 to 5.
  const worker: WorkerRecord = {
    id: invite.id,
    profileId: null,
    fullName,
    email,
    crewId: crew?.id ?? null,
    dayStartMin: 480,
    dayEndMin: 1020,
    workDays: [1, 2, 3, 4, 5, 6],
    active: true,
  };
  await repo.saveWorker(worker);

  let user: UserRecord;
  try {
    if (existing) {
      user = { ...existing, role: "worker", fullName, workerId: worker.id };
      await repo.saveUser(user);
    } else {
      user = await makeLogin(worker, details.password, invite.phone);
    }
  } catch (error) {
    // No half-made crew member: without a sign-in the row is taken back off.
    await repo.deleteWorker(worker.id).catch(() => undefined);
    console.error("[crew] join failed while making the sign-in", error);
    return fail("We couldn't set up your sign-in just now. Try again in a minute, or ask the owner for a new invite.");
  }

  const settings = await repo.getSettings();
  await notify(
    repo,
    settings,
    "approval",
    `${fullName} joined the crew`,
    `${fullName} (${email}) set up their own sign-in from your invite${invite.phone ? " sent by text" : invite.email ? ` sent to ${invite.email}` : ""}. ${crew ? `They are on ${crew.name}.` : "They are not on a crew yet: pick one under Rates, Workers."} If you don't know this person, remove them under Rates, Workers.`,
    null,
  );
  return { ok: true, worker, user, newLogin: !existing };
}
