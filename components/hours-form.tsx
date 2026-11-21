"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { addCrewHoursAction } from "@/lib/actions";
import { HOURS_LIMITS, UNLISTED_JOB } from "@/lib/domain/hours";
import { jobLine, type PickJob } from "@/lib/domain/job-pick";

/**
 * The one "Add hours" form on the crew page (and the owner's Hours page).
 * The crew member says what the hours were for: a job on their list, a job that
 * isn't listed (they type which one), or shop time. They can always log their day,
 * even when the job isn't in the app yet.
 */
export function HoursForm({
  today,
  minDate,
  back,
  week,
  workers,
  jobs,
}: {
  today: string;
  minDate: string;
  back: string;
  week?: string;
  /** Given on the owner's page, where the owner says who worked. */
  workers?: { id: string; fullName: string }[];
  jobs: PickJob[];
}) {
  const [target, setTarget] = useState("");
  const picked = jobs.find((job) => job.id === target);
  const select = "h-10 rounded-md border border-line bg-card px-3 font-normal";

  return (
    <form action={addCrewHoursAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} />
      {week && <input type="hidden" name="week" value={week} />}
      {workers && (
        <label className="grid gap-1 font-semibold sm:col-span-2">
          Who worked
          <select name="workerId" required defaultValue="" className={select}>
            <option value="" disabled>
              Pick a crew member
            </option>
            {workers.map((worker) => (
              <option key={worker.id} value={worker.id}>
                {worker.fullName}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="grid gap-1 font-semibold sm:col-span-2">
        What were the hours for?
        <select name="target" required value={target} onChange={(event) => setTarget(event.target.value)} className={select}>
          <option value="" disabled>
            Pick one
          </option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {jobLine(job)}
            </option>
          ))}
          <option value="other">A job that isn&apos;t listed</option>
          <option value="shop">Shop time (not on a job)</option>
        </select>
      </label>
      {picked && (
        <div className="rounded-md border border-line bg-paper px-3 py-2 sm:col-span-2">
          <p className="text-muted">Check it&apos;s the right job:</p>
          <p className="font-semibold">{picked.scope}</p>
          {picked.where && <p>{picked.where}</p>}
          <p>{picked.when}</p>
        </div>
      )}
      {target === "other" && (
        <label className="grid gap-1 font-semibold sm:col-span-2">
          Which job?
          <Input name="unlistedJob" required minLength={UNLISTED_JOB.min} maxLength={UNLISTED_JOB.max} placeholder="The address or the customer's name" />
        </label>
      )}
      <label className="grid gap-1 font-semibold">
        Day worked
        <Input name="date" type="date" required defaultValue={today} min={minDate} max={today} />
      </label>
      <label className="grid gap-1 font-semibold">
        Hours
        <Input name="hours" type="number" inputMode="decimal" required min={HOURS_LIMITS.min} max={HOURS_LIMITS.max} step={HOURS_LIMITS.step} placeholder="3.5" />
      </label>
      <label className="grid gap-1 font-semibold sm:col-span-2">
        <span>
          {target === "shop" ? "What you did" : "Note"} <span className="font-normal text-muted">(optional)</span>
        </span>
        <Input name="note" maxLength={HOURS_LIMITS.noteMax} placeholder={target === "shop" ? "Loaded the truck, cleaned sprayers" : "What you worked on"} />
      </label>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Saving…">Add hours</SubmitButton>
      </div>
    </form>
  );
}
