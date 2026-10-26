import { updateAccount } from "@/lib/actions";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const query = await searchParams;
  const actor = await requireActor();
  const user = await getRepository().getUser(actor.id);
  if (!user) return null;

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle>Your account</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={updateAccount} className="grid gap-4">
          <Flash notice={query.notice} error={query.error} />
          <p className="text-sm text-muted">
            Signed in as {user.email}. Role: {user.role}.
          </p>
          <div className="grid gap-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" name="fullName" defaultValue={user.fullName} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="phone">Phone</Label>
            <Input id="phone" name="phone" defaultValue={user.phone} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="billingAddress">Billing address</Label>
            <Input id="billingAddress" name="billingAddress" defaultValue={user.billingAddress} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="billingZip">Billing ZIP</Label>
            <Input id="billingZip" name="billingZip" defaultValue={user.billingZip} required maxLength={5} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="password">New password</Label>
            <Input id="password" name="password" type="password" autoComplete="new-password" placeholder="Leave blank to keep the current one" />
          </div>
          <SubmitButton>Save account</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
