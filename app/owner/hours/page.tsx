import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { addDays, hoursLabel, isDate, roundHours, weekDays, weekStart, weekTotals } from "@/lib/domain/hours";
import { formatDate, todayDetroit } from "@/lib/format";

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The owner's weekly view of crew hours: each crew member's total, day by day and
 * job by job. Hours are logged on the jobs themselves; this page only adds them up.
 */
export default async function OwnerHoursPage({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const today = todayDetroit();
  const start = weekStart(query.week && isDate(query.week) ? query.week : today);
  const days = weekDays(start);
  const repo = getRepository();
  const jobs = await repo.listJobs();
  const people = weekTotals(jobs, start);
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
            No hours were logged this week. The crew adds hours from each job page, and you can add them for anyone the same way.
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
                      <li key={item.jobId} className="flex flex-wrap justify-between gap-2">
                        <Link className="font-semibold text-pine underline" href={`/jobs/${item.jobId}`}>
                          {item.scope}
                        </Link>
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
    </div>
  );
}
