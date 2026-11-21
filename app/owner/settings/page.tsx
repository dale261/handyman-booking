import {
  addTimeOffAction,
  deleteCrewAction,
  deleteWorkerAction,
  inviteWorkerAction,
  removeTimeOffAction,
  saveCrewAction,
  saveWorkerAction,
} from "@/lib/actions";
import Link from "next/link";
import { CopyField } from "@/components/copy-field";
import { Flash } from "@/components/flash";
import { SettingsForm } from "@/components/settings-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { formatDate, formatMinutes, todayDetroit } from "@/lib/format";
import { INVITE_DAYS, INVITE_TEXT, inviteLink, prettyPhone, readInvite } from "@/lib/invites";
import { resetOrigin } from "@/lib/reset-email";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string; invite?: string; sent?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const repo = getRepository();
  const day = todayDetroit();
  const [settings, crews, workers, timeOff, usage, users] = await Promise.all([
    repo.getSettings(),
    repo.listCrews(),
    repo.listWorkers(),
    repo.listTimeOff(),
    repo.aiUsageForDay(day),
    repo.listUsers(),
  ]);
  const aiCalls = usage.reduce((sum, row) => sum + row.calls, 0);
  // An invite the owner just made. It lives only in this page's address, never in the database.
  const invite = readInvite(query.invite);
  const inviteUrl = invite && query.invite ? inviteLink(query.invite, resetOrigin()) : "";
  const inviteCrew = invite?.crewId ? crews.find((crew) => crew.id === invite.crewId) : undefined;
  const usageRows = usage.slice().sort((a, b) => b.calls - a.calls || a.customerId.localeCompare(b.customerId));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Rates and crews</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Sample crews are labeled “(sample)”. Rename them, or delete them and add your own. The first job of each crew’s day is measured from the shop address below. Other handyman work uses the{" "}
          <Link className="font-semibold text-pine underline" href="/owner/library">cost library</Link>. Today’s AI quote calls are counted below. Those two limits are spending caps, not prices.
        </p>
      </div>
      <Flash notice={query.notice} error={query.error} />
      <Card>
        <CardHeader>
          <CardTitle>Invite a crew member</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted">Type their phone number or their email. They get a link and fill in their own name, email and password.</p>
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
                Good for {INVITE_DAYS} days, and it works once. {inviteCrew ? `They'll be on ${inviteCrew.name}.` : "No crew picked: set their crew under Workers after they join."} You get a notice when they join.
              </p>
            </div>
          )}
          <form action={inviteWorkerAction} className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 font-semibold">
              Phone number or email
              <Input name="contact" required autoComplete="off" placeholder="231-555-0123 or name@email.com" />
            </label>
            <label className="grid gap-1 font-semibold">
              Crew
              <select name="crewId" defaultValue="" className="h-10 rounded-md border border-line bg-card px-3 font-normal">
                <option value="">No crew yet</option>
                {crews
                  .filter((crew) => crew.active)
                  .map((crew) => (
                    <option key={crew.id} value={crew.id}>
                      {crew.name}
                    </option>
                  ))}
              </select>
            </label>
            <div className="sm:col-span-2">
              <SubmitButton pendingLabel="Making the invite…">Invite</SubmitButton>
            </div>
          </form>
          <p className="text-muted">An email invite is sent for you. For a phone number you get a &quot;Text it&quot; button, and the text goes from your own phone.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>AI quotes today</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="font-semibold text-ink">{aiCalls}</span> of {settings.aiDailyCap} model calls used on {formatDate(day)} (Eastern time). Each customer can use {settings.aiCustomerDailyCap} a day.
          </p>
          <p className="text-muted">
            At the cap, listed services still quote from your rates. Other jobs match from the description and wait for you. Set either limit to 0 to turn the model off. The count resets at midnight Eastern.
          </p>
          {usageRows.length === 0 ? (
            <p>No AI quote calls yet today.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {usageRows.map((row) => {
                const person = users.find((user) => user.id === row.customerId);
                return (
                  <li key={row.customerId} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span>{person?.fullName || "Customer"}</span>
                    <span className="font-semibold">{row.calls}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Rates and rules</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm settings={settings} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Crews</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {crews.map((crew) => (
            <form key={crew.id} action={saveCrewAction} className="flex flex-wrap items-end gap-2 border-b border-line pb-3">
              <input type="hidden" name="id" value={crew.id} />
              <label className="grid gap-1 text-sm font-semibold">
                Name
                <Input name="name" defaultValue={crew.name} />
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={crew.active} /> Active
              </label>
              <SubmitButton size="sm">Save</SubmitButton>
              <button formAction={deleteCrewAction} className="h-8 rounded-md border border-line px-3 text-xs font-semibold">
                Delete
              </button>
            </form>
          ))}
          <form action={saveCrewAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="active" value="on" />
            <label className="grid gap-1 text-sm font-semibold">
              New crew
              <Input name="name" placeholder="Crew name" required />
            </label>
            <SubmitButton size="sm" variant="outline">Add crew</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {workers.map((worker) => (
            <form key={worker.id} action={saveWorkerAction} className="grid gap-3 border-b border-line pb-4 sm:grid-cols-2">
              <input type="hidden" name="id" value={worker.id} />
              <label className="grid gap-1 text-sm font-semibold">
                Name
                <Input name="fullName" defaultValue={worker.fullName} required />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Email
                <Input name="email" type="email" defaultValue={worker.email} required />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Crew
                <select name="crewId" defaultValue={worker.crewId ?? ""} className="h-10 rounded-md border border-line bg-card px-3 font-normal">
                  <option value="">Unassigned</option>
                  {crews.map((crew) => (
                    <option key={crew.id} value={crew.id}>{crew.name}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Password for their login
                <Input name="password" type="password" placeholder="Leave blank to keep it" autoComplete="new-password" />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Day starts (minutes, now {formatMinutes(worker.dayStartMin)})
                <Input name="dayStartMin" type="number" defaultValue={worker.dayStartMin} />
              </label>
              <label className="grid gap-1 text-sm font-semibold">
                Day ends (minutes, now {formatMinutes(worker.dayEndMin)})
                <Input name="dayEndMin" type="number" defaultValue={worker.dayEndMin} />
              </label>
              <fieldset className="flex flex-wrap gap-2 text-sm sm:col-span-2">
                <legend className="mb-1 font-semibold">Work days</legend>
                {DAYS.map((label, index) => (
                  <label key={label} className="flex items-center gap-1">
                    <input type="checkbox" name="workDays" value={index} defaultChecked={worker.workDays.includes(index)} /> {label}
                  </label>
                ))}
              </fieldset>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" defaultChecked={worker.active} /> Active
              </label>
              <div className="flex gap-2">
                <SubmitButton size="sm">Save worker</SubmitButton>
                <button formAction={deleteWorkerAction} className="h-8 rounded-md border border-line px-3 text-xs font-semibold">
                  Delete
                </button>
              </div>
            </form>
          ))}
          <form action={saveWorkerAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="active" value="on" />
            <input type="hidden" name="dayStartMin" value="480" />
            <input type="hidden" name="dayEndMin" value="1020" />
            {[1, 2, 3, 4, 5, 6].map((day) => (
              <input key={day} type="hidden" name="workDays" value={day} />
            ))}
            <label className="grid gap-1 text-sm font-semibold">
              New worker name
              <Input name="fullName" required />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Email
              <Input name="email" type="email" required />
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Crew
              <select name="crewId" className="h-10 rounded-md border border-line bg-card px-3 font-normal">
                <option value="">Unassigned</option>
                {crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>{crew.name}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Password
              <Input name="password" type="password" placeholder="Optional, 8+ characters" />
            </label>
            <SubmitButton variant="outline">Add worker</SubmitButton>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Days off</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {timeOff.length === 0 ? <p className="text-sm text-muted">No days off yet. A worker who is off cannot be booked that day.</p> : null}
          <ul className="space-y-2 text-sm">
            {timeOff.map((item) => {
              const worker = workers.find((person) => person.id === item.workerId);
              return (
                <li key={item.id} className="flex items-center justify-between gap-2">
                  <span>{worker?.fullName || "Worker"} · {formatDate(item.date)}</span>
                  <form action={removeTimeOffAction}>
                    <input type="hidden" name="id" value={item.id} />
                    <SubmitButton size="sm" variant="outline">Remove</SubmitButton>
                  </form>
                </li>
              );
            })}
          </ul>
          <form action={addTimeOffAction} className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm font-semibold">
              Worker
              <select name="workerId" className="h-10 rounded-md border border-line bg-card px-3 font-normal">
                {workers.map((worker) => (
                  <option key={worker.id} value={worker.id}>{worker.fullName}</option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-semibold">
              Date
              <Input name="date" type="date" required />
            </label>
            <SubmitButton size="sm" variant="outline">Add day off</SubmitButton>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
