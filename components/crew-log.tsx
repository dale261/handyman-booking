import Link from "next/link";
import { SubmitButton } from "@/components/submit-button";
import { reimburseAction, removeCrewEntryAction } from "@/lib/actions";
import type { ExpenseEntry } from "@/lib/db/types";
import { formatDate, todayDetroit, usd } from "@/lib/format";

/** Shown in place of the forms until the crew log's table exists. */
export function CrewLogSetupNote({ owner }: { owner: boolean }) {
  return (
    <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {owner
        ? "One setup step left: shop time, unlisted jobs and receipts can't be saved until the crew_log SQL file has been run in Supabase."
        : "Part of this page isn't switched on yet. The owner has one setup step to finish."}
    </p>
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
