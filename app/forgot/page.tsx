import Link from "next/link";
import { requestPasswordResetAction } from "@/lib/actions";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  return (
    <div className="mx-auto grid max-w-lg gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Forgot your password?</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={requestPasswordResetAction} className="grid gap-4">
            <Flash notice={query.notice} error={query.error} />
            <p className="text-sm text-muted">Enter the email you signed up with and we&apos;ll send a link to choose a new password.</p>
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <SubmitButton pendingLabel="Sending…">Send me a reset link</SubmitButton>
            <p className="text-sm text-muted">
              Remembered it? <Link className="font-semibold text-pine underline" href="/login">Sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
