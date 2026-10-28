import Link from "next/link";
import { signUp } from "@/lib/actions";
import { readDraftCookie } from "@/lib/draft-cookie";
import { DraftBanner } from "@/components/draft-banner";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  const draft = await readDraftCookie();
  return (
    <div className="grid gap-4">
      <DraftBanner action="signup" />
      <Card className="mx-auto w-full max-w-lg">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={signUp} className="grid gap-4">
            <Flash error={query.error} />
            <p className="text-sm text-muted">We use this for your quote, your invoice, and the job site when the work is at this address.</p>
            <Field id="fullName" name="fullName" label="Full name" autoComplete="name" defaultValue={draft?.fullName ?? ""} />
            <Field id="email" name="email" label="Email" type="email" autoComplete="email" defaultValue={draft?.email ?? ""} />
            <Field id="phone" name="phone" label="Phone" type="tel" autoComplete="tel" defaultValue={draft?.phone ?? ""} />
            <Field id="billingAddress" name="billingAddress" label="Billing address" autoComplete="street-address" />
            <Field id="billingZip" name="billingZip" label="Billing ZIP" inputMode="numeric" maxLength={5} defaultValue={draft?.zip ?? ""} />
            <Field id="password" name="password" label="Password" type="password" autoComplete="new-password" />
            <SubmitButton>Create account</SubmitButton>
            <p className="text-sm text-muted">
              Already have one? <Link className="font-semibold text-pine underline" href="/login">Sign in</Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ id, label, ...props }: React.ComponentProps<"input"> & { label: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} required {...props} />
    </div>
  );
}
