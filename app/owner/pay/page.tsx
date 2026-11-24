import Link from "next/link";
import { Flash } from "@/components/flash";
import { JobPick } from "@/components/job-pick";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { addFlatPayAction, addPaymentAction, addPayPersonAction, removePayItemAction, setRateAction } from "@/lib/actions";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import type { PayItem, ShopHoursEntry } from "@/lib/db/types";
import { EXPENSE_LIMITS } from "@/lib/domain/expenses";
import { canLogHours, hoursLabel } from "@/lib/domain/hours";
import { jobChoice, recentJobs } from "@/lib/domain/job-pick";
import { balances, loggedHours, methodLabel, needsRate, PAY_LIMITS, PAY_METHODS, suggestRate, totalOwed, type Balance } from "@/lib/domain/pay";
import { formatDate, todayDetroit, usd } from "@/lib/format";

/** How many unpriced entries are listed at once. The rest show as they are dealt with. */
const WAITING_SHOWN = 40;

const SELECT = "h-10 w-full min-w-0 rounded-md border border-line bg-card px-3 font-normal";

function standing(person: Pick<Balance, "owed">): string {
  if (person.owed > 0) return `Owed ${usd(person.owed)}`;
  if (person.owed < 0) return `Paid ahead ${usd(-person.owed)}`;
  return "Paid up";
}

type Person = { id: string; fullName: string; active: boolean };

function PersonSelect({ people, label, picked }: { people: Person[]; label: string; picked?: string }) {
  return (
    <label className="grid min-w-0 grid-cols-1 gap-1 font-semibold sm:col-span-2">
      {label}
      <select name="workerId" required defaultValue={picked ?? ""} className={SELECT}>
        <option value="" disabled>
          Pick a person
        </option>
        {people.map((person) => (
          <option key={person.id} value={person.id}>
            {person.fullName}
            {person.active ? "" : " (not on the crew list)"}
          </option>
        ))}
      </select>
    </label>
  );
}

/** One line of a person's record: pay they earned, or a payment to them. */
function RecordRow({ item, who, canRemember }: { item: PayItem; who: string; canRemember: boolean }) {
  return (
    <li className="space-y-1.5 rounded-md border border-line px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{item.kind === "payment" ? "Payment" : item.what}</span>
        <span className={item.kind === "payment" ? "font-semibold text-pine" : "font-semibold"}>{item.kind === "payment" ? `Paid ${usd(item.amount)}` : usd(item.amount)}</span>
      </div>
      <p className="text-muted">
        {formatDate(item.date)}
        {item.kind === "pay" && item.hours !== null && item.rate !== null ? ` · ${hoursLabel(item.hours)} at ${usd(item.rate)} an hour` : ""}
        {item.kind === "pay" && item.rate === null ? ` · flat amount${item.hours !== null ? ` for ${hoursLabel(item.hours)}` : ""}` : ""}
        {item.kind === "pay" && item.auto ? " · rate from your list" : ""}
        {item.kind === "payment" && item.method ? ` · ${methodLabel(item.method)}` : ""}
        {item.note ? <span className="block break-words">{item.note}</span> : null}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        {item.kind === "pay" && item.entryId && (
          <form action={setRateAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="who" value={who} />
            <input type="hidden" name="entryId" value={item.entryId} />
            <label className="grid gap-1 font-semibold">
              Rate, $ an hour
              <Input name="rate" inputMode="decimal" required defaultValue={item.rate ?? ""} className="w-24" />
            </label>
            <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
              Change rate
            </SubmitButton>
            {canRemember && (
              <label className="flex basis-full items-center gap-2">
                <input type="checkbox" name="remember" /> Also use it for their {item.jobId ? "next hours on this job" : "next shop time"}
              </label>
            )}
          </form>
        )}
        <form action={removePayItemAction}>
          <input type="hidden" name="who" value={who} />
          <input type="hidden" name="itemId" value={item.id} />
          <SubmitButton size="sm" variant="ghost">
            Remove
          </SubmitButton>
        </form>
      </div>
    </li>
  );
}

/**
 * Crew pay, for the owner only: hours waiting for a rate, what each person has earned
 * and been paid, and what is still owed. The crew logs hours; the owner sets the rate
 * on each entry, because the rate changes with the job. Paying someone happens outside
 * the app and is recorded here.
 */
export default async function OwnerPayPage({ searchParams }: { searchParams: Promise<{ who?: string; notice?: string; error?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const today = todayDetroit();
  const repo = getRepository();
  const ready = await repo.payReady();
  const pay = ready ? await repo.listPay() : [];
  const ratesReady = ready && (await repo.ratesReady());
  const rates = ratesReady ? await repo.listRates() : [];
  const jobs = await repo.listJobs();
  const shop = (await repo.listCrewEntries()).filter((entry): entry is ShopHoursEntry => entry.kind === "shop_hours");
  const people: Person[] = (await repo.listWorkers())
    .map((worker) => ({ id: worker.id, fullName: worker.fullName, active: worker.active }))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName));
  // The owner's own hours are tracked, not paid through here, so they never wait for a rate.
  const ownerIds = (await repo.listUsers()).filter((user) => user.role === "owner" && user.workerId).map((user) => user.workerId as string);
  const waiting = needsRate(loggedHours(jobs, shop), pay, ownerIds);
  const totals = balances(pay);
  const open = query.who ? people.find((person) => person.id === query.who) : undefined;
  const openTotals = open ? totals.find((person) => person.workerId === open.id) : undefined;
  const openItems = open ? pay.filter((item) => item.workerId === open.id) : [];
  const pickJobs = recentJobs(jobs.filter(canLogHours), today, EXPENSE_LIMITS.daysBack).map(jobChoice);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Crew pay</h1>
        <p className="text-sm text-muted">What each person has earned, what you&apos;ve paid them, and what&apos;s still owed. Only you can see this page. The crew doesn&apos;t see rates or pay.</p>
      </div>
      <Flash notice={query.notice} error={query.error} />
      {!ready ? (
        <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          One setup step left: crew pay can&apos;t be saved until the crew_pay SQL file has been run in Supabase.
        </p>
      ) : (
        <>
          {open && (
            <Card>
              <CardContent className="space-y-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-display text-xl font-semibold">{open.fullName}</p>
                  <Link className="font-semibold text-pine underline" href="/owner/pay">
                    Close
                  </Link>
                </div>
                <p>
                  Earned {usd(openTotals?.earned ?? 0)} · Paid {usd(openTotals?.paid ?? 0)} · <span className="font-semibold">{standing(openTotals ?? { owed: 0 })}</span>
                </p>
                {openItems.length === 0 ? (
                  <p className="text-muted">Nothing on record yet.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {openItems.map((item) => (
                      <RecordRow key={item.id} item={item} who={open.id} canRemember={ratesReady} />
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-display text-xl font-semibold">Hours that need a rate</p>
                <p className="text-muted">
                  {ratesReady ? "Hours your rate list doesn't cover wait here. Set the rate, and the pay is hours times rate." : "The crew logs the hours. You set the rate on each one, and the pay is hours times rate."}
                </p>
              </div>
              {waiting.length === 0 ? (
                <p className="text-muted">Every entry has a rate.</p>
              ) : (
                <ul className="space-y-1.5">
                  {waiting.slice(0, WAITING_SHOWN).map((entry) => {
                    const hint = suggestRate(pay, entry.workerId, entry.jobId, rates);
                    return (
                      <li key={entry.entryId} className="space-y-2 rounded-md border border-line px-3 py-2">
                        <p>
                          <span className="font-semibold">{entry.workerName}</span> · {hoursLabel(entry.hours)} · {formatDate(entry.date)}
                          <span className="block break-words text-muted">
                            {entry.what}
                            {entry.note ? ` · ${entry.note}` : ""}
                          </span>
                        </p>
                        <form action={setRateAction} className="flex flex-wrap items-end gap-2">
                          <input type="hidden" name="entryId" value={entry.entryId} />
                          <label className="grid gap-1 font-semibold">
                            Rate, $ an hour
                            <Input name="rate" inputMode="decimal" required defaultValue={hint?.rate ?? ""} placeholder="20" className="w-24" />
                          </label>
                          <SubmitButton size="sm" pendingLabel="Saving…">
                            Set rate
                          </SubmitButton>
                          {ratesReady && (
                            <label className="flex basis-full items-center gap-2">
                              <input type="checkbox" name="remember" defaultChecked /> Use this for their {entry.jobId ? "next hours on this job" : "next shop time"} too
                            </label>
                          )}
                        </form>
                        {hint && (
                          <p className="text-muted">
                            {hint.from === "the rate list" ? "Filled in from your rate list." : `Filled in with their last rate on ${hint.from}.`} Change it if this one is different.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {waiting.length > WAITING_SHOWN && <p className="text-muted">And {waiting.length - WAITING_SHOWN} more. They show here as you work through these.</p>}
              {ownerIds.length > 0 && <p className="text-muted">Your own hours aren&apos;t listed. They&apos;re tracked on the Hours page, not paid here.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 text-sm">
              <p className="font-display text-xl font-semibold">You owe {usd(totalOwed(totals))}</p>
              {totals.length === 0 ? (
                <p className="text-muted">No pay on record yet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {totals.map((person) => (
                    <li key={person.workerId} className="rounded-md border border-line px-3 py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <Link className="font-semibold text-pine underline" href={`/owner/pay?who=${person.workerId}`}>
                          {person.workerName}
                        </Link>
                        <span className="font-semibold">{standing(person)}</span>
                      </div>
                      <p className="text-muted">
                        Earned {usd(person.earned)} · Paid {usd(person.paid)}
                        {person.hours > 0 ? ` · ${hoursLabel(person.hours)}` : ""}
                        {person.lastPaid ? ` · Last paid ${formatDate(person.lastPaid)}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-muted">Tap a name to see every line. Receipts you pay back are separate, on the Receipts page.</p>
              <p className="flex flex-wrap gap-x-4 gap-y-1">
                <Link className="font-semibold text-pine underline" href="/owner/pay/rates">
                  Rate list
                </Link>
                <Link className="font-semibold text-pine underline" href="/owner/pay/load">
                  Load records you kept outside the app
                </Link>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-display text-xl font-semibold">Record a payment</p>
                <p className="text-muted">Pay them the way you usually do, then record it here.</p>
              </div>
              <form action={addPaymentAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {open && <input type="hidden" name="who" value={open.id} />}
                <PersonSelect people={people} label="Who you paid" picked={open?.id} />
                <label className="grid gap-1 font-semibold">
                  Day paid
                  <Input name="date" type="date" required defaultValue={today} max={today} />
                </label>
                <label className="grid gap-1 font-semibold">
                  Amount
                  <Input name="amount" inputMode="decimal" required placeholder="150" />
                </label>
                <label className="grid min-w-0 grid-cols-1 gap-1 font-semibold sm:col-span-2">
                  <span>
                    How you paid <span className="font-normal text-muted">(optional)</span>
                  </span>
                  <select name="method" defaultValue="" className={SELECT}>
                    <option value="">Not said</option>
                    {PAY_METHODS.map((method) => (
                      <option key={method.id} value={method.id}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 font-semibold sm:col-span-2">
                  <span>
                    Note <span className="font-normal text-muted">(optional)</span>
                  </span>
                  <Input name="note" maxLength={PAY_LIMITS.textMax} placeholder="What it covered" />
                </label>
                <div className="sm:col-span-2">
                  <SubmitButton pendingLabel="Saving…">Record payment</SubmitButton>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-display text-xl font-semibold">Add flat pay</p>
                <p className="text-muted">Pay that isn&apos;t by the hour: a flat amount for a job, a split, a bonus.</p>
              </div>
              <form action={addFlatPayAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {open && <input type="hidden" name="who" value={open.id} />}
                <PersonSelect people={people} label="Who earned it" picked={open?.id} />
                <label className="grid gap-1 font-semibold">
                  Day
                  <Input name="date" type="date" required defaultValue={today} max={today} />
                </label>
                <label className="grid gap-1 font-semibold">
                  Amount
                  <Input name="amount" inputMode="decimal" required placeholder="150" />
                </label>
                <label className="grid gap-1 font-semibold sm:col-span-2">
                  What it was for
                  <Input name="what" required maxLength={PAY_LIMITS.textMax} placeholder="Flat rate for the job" />
                </label>
                <JobPick
                  jobs={pickJobs}
                  blank="Not for one job"
                  label={
                    <span>
                      Job <span className="font-normal text-muted">(optional)</span>
                    </span>
                  }
                />
                <div className="sm:col-span-2">
                  <SubmitButton pendingLabel="Saving…">Add pay</SubmitButton>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="font-display text-xl font-semibold">Add someone who isn&apos;t on the crew list</p>
                <p className="text-muted">A helper for a day, or a past worker. They get no sign-in and no place on the schedule.</p>
              </div>
              <form action={addPayPersonAction} className="flex flex-wrap items-end gap-2">
                <label className="grid min-w-0 flex-1 gap-1 font-semibold">
                  Name
                  <Input name="fullName" required maxLength={80} />
                </label>
                <SubmitButton variant="outline" pendingLabel="Saving…">
                  Add
                </SubmitButton>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
