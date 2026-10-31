import Link from "next/link";
import { createOwnerJobAction } from "@/lib/actions";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { SERVICE_LABELS, type ServiceId } from "@/lib/domain/types";
import { formatMinutes, todayDetroit } from "@/lib/format";
import { OWNER_JOB_LIMITS } from "@/lib/services/owner-jobs";

const SERVICE_ORDER: ServiceId[] = ["other", "paint", "tv", "blinds", "furniture", "yard", "clean", "helper"];

/** Phone and walk-in jobs: type the customer, the work, and your price once. */
export default async function NewOwnerJobPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const settings = await getRepository().getSettings();
  const times: number[] = [];
  for (let start = settings.slotStartMin; start <= settings.slotEndMin; start += settings.slotStepMin) times.push(start);
  const fieldClass = "grid gap-1 text-sm font-semibold";
  const selectClass = "h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm font-semibold text-pine underline" href="/owner/jobs">
          All jobs
        </Link>
        <h1 className="font-display text-3xl font-semibold text-ink">Add a job</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          For jobs that come in by phone or in person. Type it once: the job gets an invoice number and a contract and invoice page right away, and you can
          email that to the customer. Your price is final here; the app won&apos;t recalculate it.
        </p>
      </div>
      <Flash error={query.error} />
      <form action={createOwnerJobAction} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>
              Full name
              <Input name="fullName" required autoComplete="off" />
            </label>
            <label className={fieldClass}>
              Phone
              <Input name="phone" type="tel" required autoComplete="off" />
            </label>
            <label className={`${fieldClass} sm:col-span-2`}>
              Email
              <Input name="email" type="email" required autoComplete="off" placeholder="Where the agreement and receipts go" />
            </label>
            <label className={fieldClass}>
              Billing address
              <Input name="billingAddress" required autoComplete="off" placeholder="Street, city, state" />
            </label>
            <label className={fieldClass}>
              Billing ZIP
              <Input name="billingZip" inputMode="numeric" pattern="\d{5}" maxLength={5} required autoComplete="off" />
            </label>
            <label className={`${fieldClass} sm:col-span-2`}>
              Temporary password for their sign-in (optional)
              <Input name="password" type="password" autoComplete="new-password" placeholder="8+ characters. Leave blank if they'll only use the emailed link" />
              <span className="font-normal text-muted">
                A new customer gets an account so the job has a home. If they already have one, this form just updates their details.
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>The work</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>
              Service
              <select name="service" defaultValue="other" className={selectClass}>
                {SERVICE_ORDER.map((id) => (
                  <option key={id} value={id}>
                    {SERVICE_LABELS[id]}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldClass}>
              Short title the customer sees
              <Input name="scope" required minLength={3} maxLength={120} placeholder="Replace bathroom faucet" />
            </label>
            <label className={`${fieldClass} sm:col-span-2`}>
              Details
              <Textarea name="description" placeholder="What you agreed to do, what they supply, anything you noticed. This prints on the agreement." />
            </label>
            <label className={`${fieldClass} sm:col-span-2`}>
              Job site address (leave blank if it&apos;s the billing address)
              <Input name="jobSiteAddress" autoComplete="off" placeholder="Street, city, state, ZIP" />
            </label>
            <label className={fieldClass}>
              Hours on site each day
              <Input name="hours" type="number" step="0.5" min={OWNER_JOB_LIMITS.minHours} max={OWNER_JOB_LIMITS.maxHours} defaultValue={2} required />
            </label>
            <label className={fieldClass}>
              Working days
              <Input name="days" type="number" step="1" min={1} max={OWNER_JOB_LIMITS.maxDays} defaultValue={1} required />
              <span className="font-normal text-muted">More than 1 reserves the crew for the same hours on consecutive working days. Weekends and days off are skipped.</span>
            </label>
            <label className={fieldClass}>
              People on site
              <Input name="crewSize" type="number" step="1" min={1} max={OWNER_JOB_LIMITS.maxCrew} defaultValue={1} required />
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Your price</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <label className={fieldClass}>
              Firm price, travel included ($)
              <Input name="total" inputMode="decimal" required placeholder="450" />
            </label>
            <label className={fieldClass}>
              Of that, travel ($, optional)
              <Input name="travel" inputMode="decimal" placeholder="0" />
              <span className="font-normal text-muted">Shown as its own line. It&apos;s what we keep if the customer declines a new price on site.</span>
            </label>
            <p className="text-sm text-muted sm:col-span-2">
              Under ${settings.depositThreshold.toLocaleString("en-US")} is paid in full to book; ${settings.depositThreshold.toLocaleString("en-US")} or more is half down.
              {!settings.licenseNumber && (
                <>
                  {" "}
                  No license number is saved under Rates, so a job of ${Math.round(settings.builderThreshold)} or more prints Michigan&apos;s licensing statement with a licensed
                  contractor doing the licensed part.
                </>
              )}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Put it on the calendar (optional)</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <label className={fieldClass}>
              Date
              <Input name="date" type="date" min={todayDetroit()} />
            </label>
            <label className={fieldClass}>
              Start time
              <select name="startMin" defaultValue={String(times[0] ?? 480)} className={selectClass}>
                {times.map((minute) => (
                  <option key={minute} value={minute}>
                    {formatMinutes(minute)}
                  </option>
                ))}
              </select>
            </label>
            <label className={fieldClass}>
              Hold the time for (hours)
              <Input name="holdHours" type="number" step="1" min={1} max={720} defaultValue={settings.holdHours} />
            </label>
            <p className="text-sm text-muted sm:col-span-3">
              The closest free crew is assigned and the time is held while the booking payment comes in; the customer gets the usual hold email. For a multi-day
              job this is the first day, and the crew has to be free for every day of the run. Mark cash or a check paid on the job page to confirm it. Leave
              the date blank to pick a time later from the job page.
            </p>
          </CardContent>
        </Card>

        <SubmitButton pendingLabel="Adding…">Add the job and open the contract</SubmitButton>
      </form>
    </div>
  );
}
