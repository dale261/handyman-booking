import Link from "next/link";
import { Flash } from "@/components/flash";
import { JobPick } from "@/components/job-pick";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { removeJobRateAction, saveJobRateAction, saveRatesAction, saveShopDefaultAction } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { EXPENSE_LIMITS } from "@/lib/domain/expenses";
import { canLogHours } from "@/lib/domain/hours";
import { jobChoice, recentJobs } from "@/lib/domain/job-pick";
import { lastRates, RATE_SHOP, RATE_USUAL, seenJobRates, shopDefault } from "@/lib/domain/pay";
import { formatDate, todayDetroit, usd } from "@/lib/format";

const SELECT = "h-10 w-full min-w-0 rounded-md border border-line bg-card px-3 font-normal";

/**
 * The owner's rate list: what each person is paid an hour in general, for shop time, and
 * on any job where it differs. As the crew logs hours, each entry gets its rate from this
 * list and keeps it, so changing the list later never changes hours already logged.
 * Owner only, like the rest of crew pay.
 */
export default async function OwnerPayRatesPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const today = todayDetroit();
  const repo = getRepository();
  const ready = await repo.ratesReady();
  const rates = ready ? await repo.listRates() : [];
  const pay = ready ? await repo.listPay() : [];
  const everyone = shopDefault(rates);
  const jobs = await repo.listJobs();
  const jobName = new Map(jobs.map((job) => [job.id, { scope: job.scope || "Job", street: (job.jobSiteAddress || "").split(",")[0].trim() }]));
  const workers = (await repo.listWorkers()).sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName));
  // On the list: everyone on the crew, and anyone else who already has a rate.
  const listed = workers.filter((worker) => worker.active || rates.some((rate) => rate.workerId === worker.id));
  const pickJobs = recentJobs(jobs.filter(canLogHours), today, EXPENSE_LIMITS.daysBack).map(jobChoice);
  const name = (jobId: string) => {
    const job = jobName.get(jobId);
    if (!job) return "A job that's no longer in the app";
    return job.street ? `${job.scope} · ${job.street}` : job.scope;
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Rate list</h1>
        <p className="text-sm text-muted">
          What each person is paid an hour. When someone logs hours, the rate is filled in from this list. Only you can see this page.{" "}
          <Link className="font-semibold text-pine underline" href="/owner/pay">
            Back to Pay
          </Link>
        </p>
      </div>
      <Flash notice={query.notice} error={query.error} />
      {!ready ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          One setup step left: the rate list can&apos;t be saved until the crew_rates SQL file has been run in Supabase. Until then you set each rate on the Pay page, the way it works now.
        </p>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-2 text-sm">
              <p className="font-semibold">How the list is used</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Hours on a job get that person&apos;s rate for that job. If there isn&apos;t one, they get the usual rate.</li>
                <li>Shop time gets that person&apos;s shop time rate. If they don&apos;t have one, it gets the shop time rate for everyone. It never gets the usual rate.</li>
                <li>If the list has no rate for the hours, they wait on the Pay page for you to set one.</li>
                <li>Leave the usual rate blank for someone whose pay changes by job, and you&apos;ll be asked the first time they work each job.</li>
                <li>Changing a rate here only affects hours logged afterwards. Hours already logged keep their rate.</li>
              </ul>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-display text-xl font-semibold">Shop time for everyone</p>
                <p className="text-muted">What shop time pays anyone who doesn&apos;t have their own shop time rate below. Someone new gets it from their first day.</p>
              </div>
              <form action={saveShopDefaultAction} className="grid grid-cols-2 gap-3">
                <label className="grid min-w-0 gap-1 font-semibold">
                  $ an hour
                  <Input name="rate" inputMode="decimal" defaultValue={everyone ?? ""} placeholder="Blank: ask me" />
                </label>
                <div className="col-span-2">
                  <SubmitButton size="sm" pendingLabel="Saving…">
                    Save
                  </SubmitButton>
                </div>
              </form>
            </CardContent>
          </Card>

          {listed.map((worker) => {
            const mine = rates.filter((rate) => rate.workerId === worker.id);
            const usual = mine.find((rate) => rate.scope === RATE_USUAL);
            const shop = mine.find((rate) => rate.scope === RATE_SHOP);
            const jobRates = mine.filter((rate) => rate.scope !== RATE_USUAL && rate.scope !== RATE_SHOP);
            const last = lastRates(pay, worker.id);
            const seen = seenJobRates(pay, rates, worker.id).slice(0, 6);
            return (
              <Card key={worker.id}>
                <CardContent className="space-y-3 text-sm">
                  <p className="font-display text-xl font-semibold">
                    {worker.fullName}
                    {worker.active ? "" : <span className="font-sans text-sm font-normal text-muted"> (not on the crew list)</span>}
                  </p>
                  <form action={saveRatesAction} className="grid grid-cols-2 gap-3">
                    <input type="hidden" name="workerId" value={worker.id} />
                    <label className="grid min-w-0 gap-1 font-semibold">
                      Usual, $ an hour
                      <Input name="usual" inputMode="decimal" defaultValue={usual?.rate ?? ""} placeholder="Blank: ask me" />
                    </label>
                    <label className="grid min-w-0 gap-1 font-semibold">
                      Shop time, $ an hour
                      <Input name="shop" inputMode="decimal" defaultValue={shop?.rate ?? ""} placeholder={everyone === null ? "Blank: ask me" : `Blank: ${usd(everyone)}`} />
                    </label>
                    <div className="col-span-2">
                      <SubmitButton size="sm" pendingLabel="Saving…">
                        Save
                      </SubmitButton>
                    </div>
                  </form>
                  {(last.work || last.shop) && (
                    <p className="text-muted">
                      {last.work ? `Last paid ${usd(last.work.rate)} an hour on ${formatDate(last.work.date)}.` : ""}
                      {last.work && last.shop ? " " : ""}
                      {last.shop ? `Last shop time: ${usd(last.shop.rate)} an hour.` : ""}
                    </p>
                  )}
                  {jobRates.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="font-semibold">Job rates</p>
                      <ul className="space-y-1.5">
                        {jobRates.map((rate) => (
                          <li key={rate.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                            <span className="min-w-0 break-words">
                              {name(rate.scope)} · <span className="font-semibold">{usd(rate.rate)} an hour</span>
                            </span>
                            <form action={removeJobRateAction}>
                              <input type="hidden" name="workerId" value={worker.id} />
                              <input type="hidden" name="jobId" value={rate.scope} />
                              <SubmitButton size="sm" variant="ghost">
                                Remove
                              </SubmitButton>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {seen.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="font-semibold">From your records</p>
                      <p className="text-muted">Rates they&apos;ve been paid on a job that aren&apos;t on the list yet.</p>
                      <ul className="space-y-1.5">
                        {seen.map((item) => (
                          <li key={item.jobId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                            <span className="min-w-0 break-words">
                              {name(item.jobId)} · {usd(item.rate)} an hour
                            </span>
                            <form action={saveJobRateAction}>
                              <input type="hidden" name="workerId" value={worker.id} />
                              <input type="hidden" name="jobId" value={item.jobId} />
                              <input type="hidden" name="rate" value={item.rate} />
                              <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
                                Add to list
                              </SubmitButton>
                            </form>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <Card>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-display text-xl font-semibold">Add a job rate</p>
                <p className="text-muted">For when someone is paid differently on one job.</p>
              </div>
              {pickJobs.length === 0 ? (
                <p className="text-muted">No jobs to pick from yet.</p>
              ) : (
                <form action={saveJobRateAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="grid min-w-0 grid-cols-1 gap-1 font-semibold sm:col-span-2">
                    Who
                    <select name="workerId" required defaultValue="" className={SELECT}>
                      <option value="" disabled>
                        Pick a person
                      </option>
                      {workers.map((worker) => (
                        <option key={worker.id} value={worker.id}>
                          {worker.fullName}
                          {worker.active ? "" : " (not on the crew list)"}
                        </option>
                      ))}
                    </select>
                  </label>
                  <JobPick jobs={pickJobs} label="Job" blank="Pick the job" required />
                  <label className="grid gap-1 font-semibold">
                    Rate, $ an hour
                    <Input name="rate" inputMode="decimal" required placeholder="15" />
                  </label>
                  <div className="sm:col-span-2">
                    <SubmitButton pendingLabel="Saving…">Save job rate</SubmitButton>
                  </div>
                </form>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
