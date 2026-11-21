import Link from "next/link";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { joinCrewAction } from "@/lib/actions";
import { currentActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { INVITE_DAYS, readInvite } from "@/lib/invites";
import { JOIN_LIMITS } from "@/lib/services/crew-join";

export const metadata = { title: "Join the crew" };

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">{children}</CardContent>
      </Card>
    </div>
  );
}

/**
 * Where a crew invite lands. The person fills in their own name, email and password
 * and gets their own sign-in. The link in the address says who invited them and when
 * it runs out; nothing about them is on file until they finish this form.
 */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ k?: string; error?: string }> }) {
  const query = await searchParams;
  const invite = readInvite(query.k);
  const actor = await currentActor();

  if (!invite) {
    return (
      <Note title="This invite link isn't working">
        <p>
          It may be more than {INVITE_DAYS} days old, or part of the link got cut off. Ask for a new invite and open it again.
        </p>
        {actor?.workerId && (
          <p>
            <Link className="font-semibold text-pine underline" href="/worker">
              Open your crew page
            </Link>
          </p>
        )}
      </Note>
    );
  }

  const repo = getRepository();
  if ((await repo.listWorkers()).some((worker) => worker.id === invite.id)) {
    return (
      <Note title="This invite has already been used">
        <p>If that was you, you already have a sign-in.</p>
        <p>
          <Link className="font-semibold text-pine underline" href="/login">
            Sign in
          </Link>
        </p>
      </Note>
    );
  }
  if (actor?.role === "owner") {
    return (
      <Note title="This link is for a crew member">
        <p>You&apos;re signed in as the owner. Have them open the link on their own phone.</p>
      </Note>
    );
  }
  if (actor?.workerId) {
    return (
      <Note title="You're already on the crew">
        <p>
          <Link className="font-semibold text-pine underline" href="/worker">
            Open your crew page
          </Link>
        </p>
      </Note>
    );
  }

  const crew = invite.crewId ? (await repo.listCrews()).find((item) => item.id === invite.crewId && item.active) : undefined;
  const token = query.k ?? "";

  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Join the eX Construction crew</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted">
            Set up your own sign-in. You get your own page with your jobs, your hours, shop time and receipts.
            {crew ? ` You'll be on ${crew.name}.` : ""}
          </p>
          <Flash error={query.error} />
          <form action={joinCrewAction} className="grid gap-4">
            <input type="hidden" name="k" value={token} />
            <label className="grid gap-1 font-semibold">
              Your name
              <Input name="fullName" required minLength={JOIN_LIMITS.nameMin} maxLength={JOIN_LIMITS.nameMax} autoComplete="name" defaultValue={actor?.fullName ?? ""} />
              <span className="font-normal text-muted">A first name is fine. Customers see it with their appointment time.</span>
            </label>
            {actor ? (
              <p>
                You&apos;re signed in as <span className="font-semibold">{actor.email}</span>. You&apos;ll join with this account.
              </p>
            ) : (
              <>
                <label className="grid gap-1 font-semibold">
                  Your email
                  <Input name="email" type="email" required autoComplete="email" defaultValue={invite.email} />
                </label>
                <label className="grid gap-1 font-semibold">
                  Choose a password
                  <Input name="password" type="password" required minLength={JOIN_LIMITS.passwordMin} maxLength={JOIN_LIMITS.passwordMax} autoComplete="new-password" />
                  <span className="font-normal text-muted">At least {JOIN_LIMITS.passwordMin} characters. You&apos;ll sign in with your email and this password.</span>
                </label>
              </>
            )}
            <SubmitButton pendingLabel="Setting up…">{actor ? "Join the crew" : "Create my sign-in"}</SubmitButton>
          </form>
          {!actor && (
            <p className="text-muted">
              Already have an account here with your email?{" "}
              <Link className="font-semibold text-pine underline" href={`/login?next=${encodeURIComponent(`/join?k=${token}`)}`}>
                Sign in first
              </Link>
              , then you&apos;ll come back to this page.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
