import { holdSlotLinkAction, startPayPalLinkAction } from "@/lib/actions";
import { SubmitButton } from "@/components/submit-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { JobRecord } from "@/lib/db/types";
import { daysOf } from "@/lib/domain/scheduling";
import { formatDate, formatDateRange, formatMinutes, usd } from "@/lib/format";
import { paypalConfigured } from "@/lib/paypal";
import type { SlotOption } from "@/lib/services/booking";

const TZ = "America/Detroit";

/**
 * The two things a customer does from their emailed contract link, with no sign-in:
 * pick a time, and pay. The secret in the link rides along as a hidden field.
 */
export function LinkTimePicker({
  job,
  token,
  slots,
  slotError,
  selectedDate,
  paidUpFront,
}: {
  job: JobRecord;
  token: string;
  slots: SlotOption[];
  slotError: string;
  selectedDate: string | undefined;
  /** Already paid: picking a time books it outright, with no hold. */
  paidUpFront: boolean;
}) {
  const dates = [...new Set(slots.map((slot) => slot.date))];
  const daySlots = slots.filter((slot) => slot.date === selectedDate);
  const linkBase = `/contract/${job.id}?k=${encodeURIComponent(token)}`;
  return (
    <Card className="no-print">
      <CardHeader>
        <CardTitle>Pick a time</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {slots.length === 0 ? (
          <p className="text-sm text-muted">{slotError || "Nothing in the next two weeks fits this job. We'll be in touch to set a time."}</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {paidUpFront ? "You're paid, so picking a time books it." : "Picking a time holds it while you pay, or pay first and pick the time whenever suits you."}{" "}
              {daysOf(job) > 1 ? `This job takes ${daysOf(job)} working days; pick the first day and the same hours are reserved each day after it.` : ""}
            </p>
            <form action={holdSlotLinkAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="when" value="earliest" />
              <SubmitButton>Earliest available · {formatDateRange(slots[0].dates)} at {formatMinutes(slots[0].startMin)}</SubmitButton>
            </form>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {dates.map((date) => (
                <a
                  key={date}
                  href={`${linkBase}&date=${date}`}
                  className={date === selectedDate ? "shrink-0 rounded-full bg-pine px-3 py-1 text-sm font-semibold text-white" : "shrink-0 rounded-full border border-line bg-card px-3 py-1 text-sm"}
                >
                  {formatDate(date)}
                </a>
              ))}
            </div>
            <div className="grid gap-2">
              {daySlots.map((slot) => (
                <form key={`${slot.date}-${slot.startMin}-${slot.crewId}`} action={holdSlotLinkAction} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm">
                  <input type="hidden" name="jobId" value={job.id} />
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="date" value={slot.date} />
                  <input type="hidden" name="startMin" value={slot.startMin} />
                  <div>
                    <p className="font-semibold">
                      {formatMinutes(slot.startMin)}
                      {slot.dates.length > 1 ? ` · through ${formatDate(slot.dates[slot.dates.length - 1])}` : ""}
                    </p>
                    <p className="text-muted">
                      {slot.memberNames.join(", ")}
                      {job.ownerPriced ? "" : ` · ${slot.travelMiles.toFixed(1)} miles from ${slot.travelFrom} · travel ${usd(slot.travelFee)}`}
                    </p>
                  </div>
                  <SubmitButton size="sm" variant="outline">{paidUpFront ? "Book this time" : "Hold this time"}</SubmitButton>
                </form>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function LinkPayCard({ job, token, due }: { job: JobRecord; token: string; due: number }) {
  const heldUntil = job.status === "held" && job.holdUntil ? new Date(job.holdUntil).toLocaleString("en-US", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }) : "";
  const why =
    job.status === "held"
      ? "to keep this time"
      : job.status === "balance_due"
        ? "for the finished work"
        : job.status === "quoted" || job.status === "released"
          ? "to book; pick a time now or whenever suits you, the price is locked once it's paid"
          : "for the new price";
  return (
    <Card className="no-print">
      <CardHeader>
        <CardTitle>Pay {usd(due)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {heldUntil ? (
          <p>
            Your time is held until <span className="font-semibold">{heldUntil}</span>. Pay {usd(due)} {why}{job.balanceDue > 0 ? ` (half down; the other ${usd(job.balanceDue)} is due after you approve the finished work)` : ""}.
          </p>
        ) : (
          <p>
            {usd(due)} is due {why}.
          </p>
        )}
        {paypalConfigured() ? (
          <form action={startPayPalLinkAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <input type="hidden" name="token" value={token} />
            <SubmitButton pendingLabel="Opening PayPal…">Pay {usd(due)} with PayPal</SubmitButton>
            <p className="mt-1 text-xs text-muted">Card or PayPal balance, no PayPal account needed. {job.agreement ? "" : "Paying accepts the agreement below."}</p>
          </form>
        ) : (
          <p>We&apos;ll contact you to take the payment.</p>
        )}
      </CardContent>
    </Card>
  );
}
