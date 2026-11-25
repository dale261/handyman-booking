import Link from "next/link";
import { JobPick } from "@/components/job-pick";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { addJobHoursAction, addShopHoursAction, reimburseAction, removeCrewEntryAction } from "@/lib/actions";
import type { ExpenseEntry } from "@/lib/db/types";
import { HOURS_LIMITS } from "@/lib/domain/hours";
import type { JobChoice } from "@/lib/domain/job-pick";
import { formatDate, todayDetroit, usd } from "@/lib/format";

/** Shown in place of the forms until the crew log's table exists. */
export function CrewLogSetupNote({ owner }: { owner: boolean }) {
  return (
    <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {owner
        ? "One setup step left: shop time and receipts can't be saved until the crew_log SQL file has been run in Supabase."
        : "Shop time and receipts aren't switched on yet. The owner has one setup step to finish."}
    </p>
  );
}

/**
 * Hours on a job, added from the crew page. The crew member picks the job from every job
 * in the app that hours can go on, so a job with no crew on it is still there to pick.
 */
export function JobHoursForm({
  today,
  minDate,
  back,
  jobs,
  week,
  workers,
}: {
  today: string;
  minDate: string;
  back: string;
  jobs: JobChoice[];
  week?: string;
  /** A crew lead's copy also asks who worked: the people on their crew. */
  workers?: { id: string; fullName: string }[];
}) {
  if (jobs.length === 0) {
    return <p className="text-muted">No jobs to pick from yet. A job shows up here as soon as the owner adds it or a customer books it.</p>;
  }
  return (
    <form action={addJobHoursAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} />
      {week && <input type="hidden" name="week" value={week} />}
      {workers && <WhoWorked workers={workers} />}
      <JobPick jobs={jobs} label="Job" blank="Pick the job" required />
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
          Note <span className="font-normal text-muted">(optional)</span>
        </span>
        <Input name="note" maxLength={HOURS_LIMITS.noteMax} placeholder="What you worked on" />
      </label>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Saving…">Add hours</SubmitButton>
      </div>
      <p className="text-muted sm:col-span-2">Job not in the list? It has to be in the app first. Ask the owner to add it.</p>
    </form>
  );
}

function WhoWorked({ workers }: { workers: { id: string; fullName: string }[] }) {
  return (
    <label className="grid min-w-0 grid-cols-1 gap-1 font-semibold sm:col-span-2">
      Who worked
      <select name="workerId" required defaultValue="" className="h-10 w-full min-w-0 rounded-md border border-line bg-card px-3 font-normal">
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
  );
}

/** Hours that weren't on a job. The owner's copy, and a crew lead's, also asks who worked. */
export function ShopTimeForm({
  today,
  minDate,
  back,
  week,
  workers,
}: {
  today: string;
  minDate: string;
  back: string;
  week?: string;
  workers?: { id: string; fullName: string }[];
}) {
  return (
    <form action={addShopHoursAction} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="back" value={back} />
      {week && <input type="hidden" name="week" value={week} />}
      {workers && <WhoWorked workers={workers} />}
      <label className="grid gap-1 font-semibold">
        Day worked
        <Input name="date" type="date" required defaultValue={today} min={minDate} max={today} />
      </label>
      <label className="grid gap-1 font-semibold">
        Hours
        <Input name="hours" type="number" inputMode="decimal" required min={HOURS_LIMITS.min} max={HOURS_LIMITS.max} step={HOURS_LIMITS.step} placeholder="1.5" />
      </label>
      <label className="grid gap-1 font-semibold sm:col-span-2">
        <span>
          What you did <span className="font-normal text-muted">(optional)</span>
        </span>
        <Input name="note" maxLength={HOURS_LIMITS.noteMax} placeholder="Loaded the truck, cleaned sprayers" />
      </label>
      <div className="sm:col-span-2">
        <SubmitButton pendingLabel="Saving…">Add shop time</SubmitButton>
      </div>
    </form>
  );
}

/** One receipt. The owner's copy shows who paid and the pay-back buttons. */
export function ReceiptRow({ entry, owner, back }: { entry: ExpenseEntry; owner: boolean; back: string }) {
  const paid = entry.reimbursedAt ? todayDetroit(new Date(entry.reimbursedAt)) : "";
  return (
    <li className="space-y-1.5 rounded-md border border-line px-3 py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-base font-semibold">{usd(entry.amount)}</span>
        <span className={paid ? "text-muted" : "font-semibold text-pine"}>{paid ? `Paid back ${formatDate(paid)}` : "Waiting to be paid back"}</span>
      </div>
      <p>
        {entry.what}
        <span className="block text-muted">
          {owner ? `${entry.workerName} · ` : ""}
          {formatDate(entry.date)}
          {entry.jobId ? (
            <>
              {" · "}
              <Link className="underline" href={`/jobs/${entry.jobId}`}>
                {entry.jobScope || "Job"}
              </Link>
            </>
          ) : null}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {entry.photoId ? (
          <a className="font-semibold text-pine underline" href={`/api/photos/${entry.photoId}`} target="_blank" rel="noreferrer">
            See the receipt
          </a>
        ) : (
          <span className="text-muted">No photo</span>
        )}
        {owner && (
          <form action={reimburseAction}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="entryId" value={entry.id} />
            <input type="hidden" name="done" value={paid ? "0" : "1"} />
            <SubmitButton size="sm" variant={paid ? "ghost" : "default"}>
              {paid ? "Undo paid back" : "Mark paid back"}
            </SubmitButton>
          </form>
        )}
        {(owner || !paid) && (
          <form action={removeCrewEntryAction}>
            <input type="hidden" name="back" value={back} />
            <input type="hidden" name="entryId" value={entry.id} />
            <SubmitButton size="sm" variant="ghost">
              Remove
            </SubmitButton>
          </form>
        )}
      </div>
    </li>
  );
}
