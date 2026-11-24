import Link from "next/link";
import { CrewLogSetupNote, ShopTimeForm } from "@/components/crew-log";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { removeCrewEntryAction } from "@/lib/actions";
import type { ShopHoursEntry } from "@/lib/db/types";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { addDays, HOURS_LIMITS, hoursLabel, isDate, roundHours, weekDays, weekStart, weekTotals } from "@/lib/domain/hours";
import { formatDate, todayDetroit } from "@/lib/format";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The owner's weekly view of crew hours: each crew member's total, day by day and
 * job by job. Job hours are logged on the jobs themselves; shop time (hours not on
 * a job) is added from the crew page or at the bottom of this one.
 */
export default async function OwnerHoursPage({ searchParams }: { searchParams: Promise<{ week?: string; notice?: string; error?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const today = todayDetroit();
  const start = weekStart(query.week && isDate(query.week) ? query.week : today);
  const days = weekDays(start);
  const repo = getRepository();
  const jobs = await repo.listJobs();
  const logReady = await repo.crewLogReady();
  const shop = (await repo.listCrewEntries()).filter((entry): entry is ShopHoursEntry => entry.kind === "shop_hours");
  const shopThisWeek = shop.filter((entry) => entry.date >= start && entry.date <= days[6]);
  const workers = (await repo.listWorkers()).filter((worker) => worker.active).map((worker) => ({ id: worker.id, fullName: worker.fullName }));
  const people = weekTotals(jobs, start, shop);
  const everyone = roundHours(people.reduce((sum, person) => sum + person.total, 0));
  const isThisWeek = start === weekStart(today);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Crew hours</h1>
        <p className="text-sm text-muted">
          Week of {formatDate(start)} through {formatDate(days[6])}
          {isThisWeek ? " (this week)" : ""}. A week runs Monday through Sunday.
        </p>
      </div>
      <Flash notice={query.notice} error={query.error} />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="rounded-md border border-line bg-card px-3 py-1.5 font-semibold" href={`/owner/hours?week=${addDays(start, -7)}`}>
          Earlier week
        </Link>
        {!isThisWeek && (
          <>
            <Link className="rounded-md border border-line bg-card px-3 py-1.5 font-semibold" href={`/owner/hours?week=${addDays(start, 7)}`}>
              Later week
            </Link>
            <Link className="rounded-md border border-line bg-card px-3 py-1.5 font-semibold" href="/owner/hours">
              This week
            </Link>
          </>
        )}
      </div>
      {people.length === 0 ? (
        <Card>
          <CardContent className="text-sm text-muted">
            No hours were logged this week. The crew adds job hours and shop time from their crew page. You can add either for anyone: job hours on the job&apos;s page, shop time below.
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="text-sm">
            Everyone together: <span className="font-semibold">{hoursLabel(everyone)}</span>
          </p>
          <div className="grid gap-3">
            {people.map((person) => (
              <Card key={person.workerId}>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-display text-xl font-semibold">{person.workerName}</p>
                    <p className="text-base font-semibold">{hoursLabel(person.total)}</p>
                  </div>
                  <div className="grid grid-cols-7 gap-1 text-center">
                    {days.map((day, index) => (
                      <div key={day} className="rounded-md border border-line px-1 py-1.5">
                        <p className="text-xs text-muted">{DAY_NAMES[index]}</p>
                        <p className={person.byDay[day] ? "font-semibold" : "text-muted"}>{person.byDay[day] ?? "–"}</p>
                      </div>
                    ))}
                  </div>
                  <ul className="space-y-1">
                    {person.byJob.map((item) => (
                      <li key={item.jobId || "shop"} className="flex flex-wrap justify-between gap-2">
                        {item.jobId ? (
                          <Link className="font-semibold text-pine underline" href={`/jobs/${item.jobId}`}>
                            {item.scope}
                          </Link>
                        ) : (
                          <span className="font-semibold">{item.scope}</span>
                        )}
                        <span>{hoursLabel(item.hours)}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      <Card>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-display text-xl font-semibold">Shop time</p>
            <p className="text-muted">Hours that weren&apos;t on a job: loading up, cleaning tools, a supply run. They count in the totals above.</p>
          </div>
          {shopThisWeek.length === 0 ? (
            <p className="text-muted">No shop time this week.</p>
          ) : (
            <ul className="space-y-1.5">
              {shopThisWeek.map((entry) => (
                <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2">
                  <span>
                    <span className="font-semibold">{hoursLabel(entry.hours)}</span> · {formatDate(entry.date)} · {entry.workerName}
                    {entry.note ? <span className="block text-muted">{entry.note}</span> : null}
                  </span>
                  <form action={removeCrewEntryAction}>
                    <input type="hidden" name="back" value="/owner/hours" />
                    <input type="hidden" name="week" value={start} />
                    <input type="hidden" name="entryId" value={entry.id} />
                    <SubmitButton size="sm" variant="ghost">
                      Remove
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-3 border-t border-line pt-3">
            <p className="font-semibold">Add shop time for someone</p>
            {logReady ? (
              <ShopTimeForm today={today} minDate={addDays(today, -HOURS_LIMITS.daysBack)} back="/owner/hours" week={start} workers={workers} />
            ) : (
              <CrewLogSetupNote owner />
            )}
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1">
            <Link className="font-semibold text-pine underline" href="/owner/pay">
              Crew pay
            </Link>
            <Link className="font-semibold text-pine underline" href="/owner/receipts">
              Receipts to pay back
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
