import Link from "next/link";
import { BookForm } from "@/components/book-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";

export default async function BookPage() {
  const actor = await requireActor();
  if (actor.role === "worker") {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Crew members don&apos;t request quotes</CardTitle>
        </CardHeader>
        <CardContent>
          <Link className="font-semibold text-pine underline" href="/worker">
            Go to your crew list
          </Link>
        </CardContent>
      </Card>
    );
  }
  const repo = getRepository();
  const user = await repo.getUser(actor.id);
  const ready = Boolean(user && user.fullName.trim() && user.phone.trim() && user.billingAddress.trim() && /^\d{5}$/.test(user.billingZip));
  if (!user || !ready) {
    return (
      <Card className="mx-auto max-w-lg">
        <CardHeader>
          <CardTitle>Finish your account first</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>A quote needs your name, phone, and billing address with a 5-digit ZIP. That address is the job site unless you enter a different one.</p>
          <Link className="font-semibold text-pine underline" href="/account">
            Update your account
          </Link>
        </CardContent>
      </Card>
    );
  }
  const [workers, settings] = await Promise.all([repo.listWorkers(), repo.getSettings()]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Request a quote</h1>
        <p className="mt-2 text-sm text-muted">Tell us the job. You&apos;ll see a price before anyone drives out.</p>
      </div>
      <Card>
        <CardContent>
          <BookForm
            billingAddress={`${user.billingAddress} ${user.billingZip}`}
            workers={workers.filter((worker) => worker.active).map((worker) => ({ id: worker.id, fullName: worker.fullName }))}
            helperMax={settings.helperMax}
            helperMaxHours={settings.helperMaxHours}
          />
        </CardContent>
      </Card>
    </div>
  );
}
