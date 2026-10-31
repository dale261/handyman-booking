import Link from "next/link";
import { setNewPasswordAction } from "@/lib/actions";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { currentActor } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/db/index";
import { peekLocalResetToken } from "@/lib/password-reset";

/** Choose a new password. On the live site the emailed link signed the person in first. */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ t?: string; error?: string }> }) {
  const query = await searchParams;
  const token = query.t ?? "";
  const ready = supabaseConfigured() ? Boolean(await currentActor()) : Boolean(token && peekLocalResetToken(token));

  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
        </CardHeader>
        <CardContent>
          {ready ? (
            <form action={setNewPasswordAction} className="grid gap-4">
              <Flash error={query.error} />
              {token && <input type="hidden" name="token" value={token} />}
              <div className="grid gap-1.5">
                <Label htmlFor="password">New password</Label>
                <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="passwordAgain">Type it again</Label>
                <Input id="passwordAgain" name="passwordAgain" type="password" autoComplete="new-password" minLength={8} required />
              </div>
              <SubmitButton pendingLabel="Saving…">Save password</SubmitButton>
            </form>
          ) : (
            <div className="space-y-3 text-sm">
              <Flash error={query.error} />
              <p>This reset link has expired, was already used, or was opened somewhere else. Ask for a fresh one and open it in the same browser.</p>
              <Link className="font-semibold text-pine underline" href="/forgot">
                Send me a new link
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
