import Link from "next/link";
import { demoSignIn, signIn } from "@/lib/actions";
import { demoSignInAllowed } from "@/lib/demo";
import { DraftBanner } from "@/components/draft-banner";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string; next?: string }> }) {
  const query = await searchParams;
  const showDemo = demoSignInAllowed();

  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <DraftBanner action="login" />
      <Card>
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={signIn} className="grid gap-4">
            <Flash notice={query.notice} error={query.error} />
            {query.next && <input type="hidden" name="next" value={query.next} />}
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <SubmitButton>Sign in</SubmitButton>
            <p className="text-sm text-muted">
              New here? <Link className="font-semibold text-pine underline" href="/signup">Create an account</Link>
            </p>
          </form>
        </CardContent>
      </Card>
      {showDemo && (
        <Card>
          <CardHeader>
            <CardTitle>Sample sign-in</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>These sample accounts are only on this computer, before the database is connected. They have no password.</p>
            <div className="flex flex-wrap gap-2">
              <Demo role="customer" label="Sample customer" />
              <Demo role="worker" label="Worker A" />
              <Demo role="owner" label="Owner (sample)" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Demo({ role, label }: { role: string; label: string }) {
  return (
    <form action={demoSignIn}>
      <input type="hidden" name="role" value={role} />
      <SubmitButton variant="outline">{label}</SubmitButton>
    </form>
  );
}
