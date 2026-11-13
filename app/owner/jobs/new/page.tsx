import Link from "next/link";
import { createOwnerJobAction } from "@/lib/actions";
import { CustomerPicker } from "@/components/customer-picker";
import { Flash } from "@/components/flash";
import { PasteFill } from "@/components/paste-fill";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { realEmail } from "@/lib/domain/contact";
import { SERVICE_LABELS, type ServiceId } from "@/lib/domain/types";
import { todayDetroit } from "@/lib/format";
import { OWNER_JOB_LIMITS } from "@/lib/services/owner-jobs";

const SERVICE_ORDER: ServiceId[] = ["other", "paint", "tv", "blinds", "furniture", "yard", "clean", "helper"];

/** Phone and walk-in jobs: type the customer, the work, and your price once. */
export default async function NewOwnerJobPage({ searchParams }: { searchParams: Promise<{ error?: string; customer?: string; lead?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const repo = getRepository();
  const [settings, users] = await Promise.all([repo.getSettings(), repo.listUsers()]);
  // Returning customers, by name; picking one fills the Customer card from their account.
  const customers = users
    .filter((user) => user.role === "customer")
    .sort((a, b) => a.fullName.localeCompare(b.fullName))
    .map((user) => ({ id: user.id, label: `${user.fullName || user.email}${user.phone ? ` · ${user.phone}` : ""}` }));
  const picked = query.customer ? users.find((user) => user.id === query.customer && user.role === "customer") : undefined;
  // Coming from Leads: the request they typed on the price page fills the form.
  const found = !picked && query.lead && /^[0-9a-f-]{36}$/i.test(query.lead) ? await repo.getLead(query.lead) : null;
  const lead = found && !found.jobId ? found : null;
  const start = {
    fullName: picked?.fullName ?? lead?.fullName ?? "",
    phone: picked?.phone ?? lead?.phone ?? "",
    email: picked ? realEmail(picked.email) : (lead?.email ?? ""),
    billingAddress: picked?.billingAddress ?? lead?.address ?? "",
    billingZip: picked?.billingZip ?? lead?.zip ?? "",
  };
  const fieldClass = "grid gap-1 text-sm font-semibold";
  const selectClass = "h-10 rounded-md border border-line bg-card px-3 text-sm font-normal";
  const today = todayDetroit();

  return (
    <div className="space-y-6">
      <div>
        <Link className="text-sm font-semibold text-pine underline" href="/owner/jobs">
          All jobs
        </Link>
        <h1 className="font-display text-3xl font-semibold text-ink">Add a job</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          For jobs that come in by phone or in person. Type it once: the job gets an invoice number and an agreement and invoice page right away. Then you pick
          the time from the open times, and the customer gets one email with a link to sign and pay, no sign-in. Work that&apos;s already done skips the
          scheduling and goes out as an invoice. Your price is final here; the app won&apos;t recalculate it.
        </p>
      </div>
      <Flash error={query.error} />
      <form action={createOwnerJobAction} className="space-y-6">
        {lead ? (
          <>
            <input type="hidden" name="leadId" value={lead.id} />
            <p className="rounded-md border border-line bg-card p-4 text-sm">
              Filled in from {lead.fullName}&apos;s request on the price page. Check it, then add the title and your price.
              {lead.total != null ? ` They saw $${lead.total.toLocaleString("en-US")} on the site.` : ""}
            </p>
          </>
        ) : (
          !picked && <PasteFill />
        )}
        <Card key={picked?.id ?? lead?.id ?? "new"}>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {customers.length > 0 && <CustomerPicker customers={customers} selected={picked?.id ?? ""} />}
            <label className={fieldClass}>
              Full name
              <Input name="fullName" required autoComplete="off" defaultValue={start.fullName} />
            </label>
            <label className={fieldClass}>
              Phone
              <Input name="phone" type="tel" required autoComplete="off" defaultValue={start.phone} />
            </label>
            <label className={`${fieldClass} sm:col-span-2`}>
              Email (optional)
              <Input name="email" type="email" autoComplete="off" placeholder="Where the agreement and receipts go" defaultValue={start.email} />
              <span className="font-normal text-muted">Leave it blank for a phone-only customer: nothing is emailed, and you text them their link instead.</span>
            </label>
            <label className={fieldClass}>
              Billing address (optional for finished work)
              <Input name="billingAddress" autoComplete="off" placeholder="Street, city, state" defaultValue={start.billingAddress} />
            </label>
            <label className={fieldClass}>
              Billing ZIP
              <Input name="billingZip" inputMode="numeric" pattern="\d{5}" maxLength={5} autoComplete="off" defaultValue={start.billingZip} />
            </label>
            <label className={`${fieldClass} sm:col-span-2`}>
              Temporary password for their sign-in (optional)
              <Input name="password" type="password" autoComplete="new-password" placeholder="8+ characters. Leave blank; the emailed link needs no sign-in" />
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
              Is the work done yet?
              <select name="done" defaultValue="schedule" className={selectClass}>
                <option value="schedule">Not yet: we&apos;ll schedule it (agreement)</option>
                <option value="done">Already done: send an invoice</option>
              </select>
              <span className="font-normal text-muted">Already done means no time to pick, nothing to sign, and the whole price is due now.</span>
            </label>
            <label className={fieldClass}>
              Date the work was done
              <Input name="doneOn" type="date" max={today} defaultValue={today} />
              <span className="font-normal text-muted">Only used when the work is already done. It prints on the invoice.</span>
            </label>
            <label className={fieldClass}>
              Service
              <select name="service" defaultValue={lead?.service ?? "other"} className={selectClass}>
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
              <Textarea name="description" defaultValue={lead?.description ?? ""} placeholder="What you agreed to do, what they supply, anything you noticed. This prints on the agreement." />
            </label>
            <label className={`${fieldClass} sm:col-span-2`}>
              Job site address (leave blank if it&apos;s the billing address)
              <Input name="jobSiteAddress" autoComplete="off" placeholder="Street, city, state, ZIP" />
              <span className="font-normal text-muted">Work to schedule needs an address with a ZIP so the crew can get there. Finished work can go without one.</span>
            </label>
            <label className={fieldClass}>
              Hours on site each day
              <Input name="hours" type="number" step="0.5" min={OWNER_JOB_LIMITS.minHours} max={OWNER_JOB_LIMITS.maxHours} defaultValue={2} required />
              <span className="font-normal text-muted">Hours, days, and people only matter for work still to schedule.</span>
            </label>
            <label className={fieldClass}>
              How many days the job takes
              <Input name="days" type="number" step="1" min={1} max={OWNER_JOB_LIMITS.maxDays} defaultValue={1} required />
              <span className="font-normal text-muted">Usually 1. More than 1 reserves the crew for the same hours on back-to-back working days; weekends and days off are skipped.</span>
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
              Under ${settings.depositThreshold.toLocaleString("en-US")} is paid in full to book; ${settings.depositThreshold.toLocaleString("en-US")} or more is half down. Work that&apos;s already done is due in full.
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

        <p className="text-sm text-muted">
          Next you pick the time from this job&apos;s open times (the crew and the drive already figured in). The customer is emailed their link the moment a
          time is held, or you can email them the link to choose it themselves. For work that&apos;s already done you land on the invoice instead, ready to email.
        </p>

        <SubmitButton pendingLabel="Adding…">Add the job</SubmitButton>
      </form>
    </div>
  );
}
