import {
  addTimeOffAction,
  deleteCrewAction,
  deleteWorkerAction,
  removeTimeOffAction,
  saveCrewAction,
  saveWorkerAction,
} from "@/lib/actions";
import { Flash } from "@/components/flash";
import { SettingsForm } from "@/components/settings-form";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireRole } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { formatDate, formatMinutes } from "@/lib/format";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  await requireRole("owner");
  const query = await searchParams;
  const repo = getRepository();
  const [settings, crews, workers, timeOff] = await Promise.all([
    repo.getSettings(),
    repo.listCrews(),
    repo.listWorkers(),
    repo.listTimeOff(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold text-pine">Rates and crews</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Sample crews are labeled “(sample)”. Rename them or delete them and add your own. The first job of each crew’s day is measured from the shop address below.
        </p>
      </div>
      <Flash notice={query.notice} error={query.error} />
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
