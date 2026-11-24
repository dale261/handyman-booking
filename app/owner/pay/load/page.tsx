import Link from "next/link";
import { Flash } from "@/components/flash";
import { PayLoad } from "@/components/pay-load";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { clearLoadedPayAction } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";

/**
 * Load pay records the owner kept outside the app: one line per day worked or payment
 * made. The file is checked and shown first; nothing is saved until the owner loads it.
 * Owner only, like the rest of crew pay.
 */
export default async function OwnerPayLoadPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const repo = getRepository();
  const ready = await repo.payReady();
  const loaded = ready ? (await repo.listPay()).filter((item) => item.loaded).length : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Load pay records</h1>
        <p className="text-sm text-muted">
          Bring in the hours, rates, pay and payments you&apos;ve kept outside the app. Only you can see this page.{" "}
          <Link className="font-semibold text-pine underline" href="/owner/pay">
            Back to Pay
          </Link>
        </p>
      </div>
      <Flash notice={query.notice} error={query.error} />
      {!ready ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          One setup step left: crew pay can&apos;t be saved until the crew_pay SQL file has been run in Supabase.
        </p>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted">The file needs these columns: date, worker, job, job_number, hours, rate, pay, note. A payment is a line with &quot;payment&quot; in the job column.</p>
              <PayLoad />
            </CardContent>
          </Card>
          {loaded > 0 && (
            <Card>
              <CardContent className="space-y-3 text-sm">
                <div>
                  <p className="font-display text-xl font-semibold">Undo a load</p>
                  <p className="text-muted">
                    {loaded} {loaded === 1 ? "line is" : "lines are"} on record from a file. This takes all of them off. Rates you set and payments you recorded on the Pay page stay.
                  </p>
                </div>
                <form action={clearLoadedPayAction}>
                  <SubmitButton variant="outline" pendingLabel="Removing…">
                    Remove what was loaded
                  </SubmitButton>
                </form>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
