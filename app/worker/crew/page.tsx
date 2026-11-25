import Link from "next/link";
import { CopyField } from "@/components/copy-field";
import { CrewLogSetupNote, JobHoursForm, ShopTimeForm } from "@/components/crew-log";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { changeHoursAction, inviteCrewAction, removeCrewEntryAction, removeJobHoursAction } from "@/lib/actions";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { EXPENSE_LIMITS } from "@/lib/domain/expenses";
import { addDays, canLogHours, HOURS_LIMITS, hoursLabel, isDate, weekStart } from "@/lib/domain/hours";
import { jobChoice, recentJobs } from "@/lib/domain/job-pick";
import { formatDate, todayDetroit, usd } from "@/lib/format";
import { INVITE_DAYS, INVITE_TEXT, inviteLink, prettyPhone, readInvite } from "@/lib/invites";
import { resetOrigin } from "@/lib/reset-email";
import { crewWeek } from "@/lib/services/crew-week";

/**
 * A crew lead's page for the crew they lead: a week of everyone's hours and what those
 * hours pay, a way to fix or remove an entry, forms to add hours for someone, and the
 * invite for a new person. What it may show is decided in crewWeek, on the server: this
 * crew only, pay lines only, never a payment or a balance.
 */
export default async function CrewLeadPage({ searchParams }: { searchParams: Promise<{ week?: string; notice?: string; error?: string; invite?: string; sent?: string }> }) {
  const actor = await requireActor();
  const query = await searchParams;
  const repo = getRepository();
  const today = todayDetroit();
  const view = await crewWeek(repo, actor, query.week && isDate(query.week) ? query.week : today);
  if (!view) {
    return (
      <p>
        This page is for crew leads.{" "}
        <Link className="font-semibold text-pine underline" href={actor.role === "owner" ? "/owner/hours" : actor.role === "worker" ? "/worker" : "/jobs"}>
          Go back
        </Link>
      </p>
    );
  }
  const isThisWeek = view.start === weekStart(today);
  const people = view.members.map((member) => ({ id: member.id, fullName: member.me ? `${member.fullName} (you)` : member.fullName }));
  const jobs = recentJobs((await repo.listJobs()).filter(canLogHours), today, EXPENSE_LIMITS.daysBack).map(jobChoice);
  const logReady = await repo.crewLogReady();
  const minDate = addDays(today, -HOURS_LIMITS.daysBack);
  // An invite the lead just made. It lives only in this page's address, never in the database.
  const invite = readInvite(query.invite);
  const inviteUrl = invite && query.invite ? inviteLink(query.invite, resetOrigin()) : "";

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">{view.crewName}</h1>
        <p className="text-sm text-muted">
          Week of {formatDate(view.start)} through {formatDate(view.end)}
          {isThisWeek ? " (this week)" : ""}. You see your own crew only.{" "}
          <Link className="font-semibold text-pine underline" href="/worker">
            Back to my page
          </Link>
        </p>
      </div>
      <Flash notice={query.notice} error={query.error} />
      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="rounded-md border border-line bg-card px-3 py-1.5 font-semibold" href={`/worker/crew?week=${addDays(view.start, -7)}`}>
          Earlier week
        </Link>
        {!isThisWeek && (
          <>
            <Link className="rounded-md border border-line bg-card px-3 py-1.5 font-semibold" href={`/worker/crew?week=${addDays(view.start, 7)}`}>
              Later week
            </Link>
            <Link className="rounded-md border border-line bg-card px-3 py-1.5 font-semibold" href="/worker/crew">
              This week
            </Link>
          </>
        )}
      </div>

      {view.members.map((member) => (
        <Card key={member.id}>
          <CardContent className="space-y-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="font-display text-xl font-semibold">
                {member.fullName}
                {member.me ? <span className="font-sans text-sm font-normal text-muted"> (you)</span> : null}
              </p>
              <p className="text-base font-semibold">
                {hoursLabel(member.hours)} · {usd(member.earned)}
              </p>
            </div>
            {member.waiting > 0 && <p className="text-muted">{hoursLabel(member.waiting)} have no rate yet. The owner sets it.</p>}
            {member.entries.length === 0 && member.other.length === 0 ? (
              <p className="text-muted">Nothing logged this week.</p>
            ) : (
              <ul className="grid grid-cols-1 gap-2">
                {member.entries.map((entry) => (
                  <li key={entry.id} className="grid min-w-0 grid-cols-1 gap-2 rounded-md border border-line px-3 py-2">
                    <div className="min-w-0 break-words">
                      <span className="font-semibold">{hoursLabel(entry.hours)}</span> · {formatDate(entry.date)} · {entry.what}
                      {entry.note ? <span className="block text-muted">{entry.note}</span> : null}
                      <span className="block text-muted">{entry.rate === null || entry.pay === null ? "No rate yet" : `${usd(entry.rate)} an hour · ${usd(entry.pay)}`}</span>
                    </div>
                    <div className="flex flex-wrap items-end gap-2">
                      <form action={changeHoursAction} className="flex items-end gap-2">
                        <input type="hidden" name="back" value="/worker/crew" />
                        <input type="hidden" name="week" value={view.start} />
                        {entry.jobId && <input type="hidden" name="jobId" value={entry.jobId} />}
                        <input type="hidden" name="entryId" value={entry.id} />
                        <label className="grid gap-1 text-xs font-semibold">
                          Change hours
                          <Input name="hours" type="number" inputMode="decimal" required defaultValue={entry.hours} min={HOURS_LIMITS.min} max={HOURS_LIMITS.max} step={HOURS_LIMITS.step} className="h-9 w-24" />
                        </label>
                        <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
                          Save
                        </SubmitButton>
                      </form>
                      <form action={entry.jobId ? removeJobHoursAction : removeCrewEntryAction}>
                        <input type="hidden" name="back" value="/worker/crew" />
                        <input type="hidden" name="week" value={view.start} />
                        {entry.jobId && <input type="hidden" name="jobId" value={entry.jobId} />}
                        <input type="hidden" name="entryId" value={entry.id} />
                        <SubmitButton size="sm" variant="ghost">
                          Remove
                        </SubmitButton>
                      </form>
                    </div>
                  </li>
                ))}
                {member.other.map((line) => (
                  <li key={line.id} className="min-w-0 break-words rounded-md border border-line px-3 py-2">
                    <span className="font-semibold">{usd(line.amount)}</span> · {formatDate(line.date)} · {line.what}
                    <span className="block text-muted">
                      {line.hours !== null && line.rate !== null ? `${hoursLabel(line.hours)} at ${usd(line.rate)} an hour, from the owner's records` : "Flat pay, set by the owner"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-display text-xl font-semibold">Add hours for someone</p>
            <p className="text-muted">For when someone on your crew didn&apos;t log their own. The owner gets an email each time you add, change or remove hours.</p>
          </div>
          <div className="space-y-3 border-t border-line pt-3">
            <p className="font-semibold">Hours on a job</p>
            <JobHoursForm today={today} minDate={minDate} back="/worker/crew" week={view.start} jobs={jobs} workers={people} />
          </div>
          <div className="space-y-3 border-t border-line pt-3">
            <p className="font-semibold">Shop time</p>
            {logReady ? <ShopTimeForm today={today} minDate={minDate} back="/worker/crew" week={view.start} workers={people} /> : <CrewLogSetupNote owner={false} />}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 text-sm">
          <div>
            <p className="font-display text-xl font-semibold">Invite someone to {view.crewName}</p>
            <p className="text-muted">Type their phone number or their email. They get a link and fill in their own name, email and password.</p>
          </div>
          {invite && (
            <div className="space-y-3 rounded-md border border-pine/20 bg-pine/10 p-3">
              {invite.email ? (
                query.sent === "1" ? (
                  <p>
                    <span className="font-semibold">Invite emailed to {invite.email}.</span> Nothing more to do. You can also share the link yourself.
                  </p>
                ) : (
                  <p>
                    <span className="font-semibold">The email to {invite.email} didn&apos;t send.</span> Share the link yourself instead.
                  </p>
                )
              ) : (
                <p>
                  <span className="font-semibold">Invite ready for {prettyPhone(invite.phone)}.</span> Tap &quot;Text it&quot; and send the text from your phone.
                </p>
              )}
              <CopyField label="Invite link" value={inviteUrl} phone={invite.phone ? prettyPhone(invite.phone) : undefined} textBody={INVITE_TEXT} what="the invite link" />
              <p className="text-muted">
                Good for {INVITE_DAYS} days, and it works once. They&apos;ll be on {view.crewName}. The owner gets a notice when they join.
              </p>
            </div>
          )}
          <form action={inviteCrewAction} className="grid grid-cols-1 gap-3">
            <label className="grid min-w-0 gap-1 font-semibold">
              Phone number or email
              <Input name="contact" required autoComplete="off" placeholder="231-555-0123 or name@email.com" />
            </label>
            <div>
              <SubmitButton pendingLabel="Making the invite…">Invite</SubmitButton>
            </div>
          </form>
          <p className="text-muted">An email invite is sent for you. For a phone number you get a &quot;Text it&quot; button, and the text goes from your own phone.</p>
        </CardContent>
      </Card>
      <p className="text-sm text-muted">Rates and payments are the owner&apos;s. You can&apos;t change a rate here, and you don&apos;t see what has been paid.</p>
    </div>
  );
}
