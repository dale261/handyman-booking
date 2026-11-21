import { whiteLabelAction } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";
import type { JobRecord } from "@/lib/db/types";

/**
 * The white-label choice for one job. Off, it's a small fold-out so a homeowner can
 * skip past it. On, it says plainly what changes: the crew works as the customer's
 * own technician and no photos from the job are posted. The customer or the owner can
 * turn it on; the owner can't undo a choice the customer made.
 */
export function WhiteLabelCard({
  job,
  viewer,
  token,
}: {
  job: Pick<JobRecord, "id" | "status" | "whiteLabel">;
  viewer: "owner" | "customer";
  /** The link secret, when the page was opened from the emailed link. */
  token?: string;
}) {
  if (job.status === "cancelled") return null;
  const owner = viewer === "owner";
  const fields = (
    <>
      <input type="hidden" name="jobId" value={job.id} />
      {token && <input type="hidden" name="token" value={token} />}
    </>
  );

  if (job.whiteLabel) {
    const customerChose = job.whiteLabel.by === "customer";
    return (
      <div className="no-print rounded-md border border-pine/30 bg-pine/5 px-4 py-3 text-sm">
        <p className="font-semibold">White-label service is on</p>
        <p className="mt-1">
          {owner
            ? "On site, the crew works as the customer's technician, with no eX Construction name or branding. Photos from this job are never posted."
            : "On site, we work as your company's technician, without our own name or branding. We never post photos of this job."}
        </p>
        {owner && customerChose ? (
          <p className="mt-1 text-muted">The customer chose this, so only they can turn it off.</p>
        ) : (
          <form action={whiteLabelAction} className="mt-2">
            {fields}
            <input type="hidden" name="on" value="0" />
            <SubmitButton size="sm" variant="outline" pendingLabel="Saving…">
              Turn off white-label
            </SubmitButton>
          </form>
        )}
      </div>
    );
  }

  return (
    <details className="no-print rounded-md border border-line bg-card px-4 py-3 text-sm">
      <summary className="cursor-pointer font-semibold">{owner ? "White-label job?" : "Booking for a store or a property you manage?"}</summary>
      <p className="mt-2">
        {owner
          ? "Turn this on when the customer wants the crew to work as their own technician. The crew sees it on the job page, the contract changes to match, and no photos from this job get posted."
          : "Choose white-label service. On site, we work as your company's technician, without our own name or branding, and we never post photos of the job."}
      </p>
      <form action={whiteLabelAction} className="mt-2">
        {fields}
        <input type="hidden" name="on" value="1" />
        <SubmitButton size="sm" pendingLabel="Saving…">
          Turn on white-label
        </SubmitButton>
      </form>
    </details>
  );
}
