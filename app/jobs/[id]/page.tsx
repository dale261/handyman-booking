import { notFound } from "next/navigation";
import {
  approveWorkAction,
  cancelAction,
  completeWorkAction,
  decideAreaAction,
  demoPayAction,
  holdSlotAction,
  manualPayAction,
  markRefundAction,
  reassignAction,
  referOutAction,
  releaseHoldAction,
  releaseLicenseAction,
  reportProblemAction,
  requestCancelAction,
  resolveCancelAction,
  resumeProblemAction,
  reviewAction,
  startPayPalAction,
  startWorkAction,
} from "@/lib/actions";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import type { JobRecord, PaymentRecord } from "@/lib/db/types";
import { CUSTOMER_PRICE_NOTE } from "@/lib/domain/library";
import { formatDate, formatMinutes, usd } from "@/lib/format";
import { STATUS_LABEL, statusTone } from "@/lib/labels";
import { paypalConfigured } from "@/lib/paypal";
import { amountPaid, listOpenSlots, visibleTo, type SlotOption } from "@/lib/services/booking";

export default async function JobPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; error?: string; date?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await requireActor();
  const repo = getRepository();
  const job = await repo.getJob(id);
  if (!job || !(await visibleTo(repo, actor, job))) notFound();

  const [payments, crews, workers, review, settings] = await Promise.all([
    repo.listPayments(job.id),
    repo.listCrews(),
    repo.listWorkers(),
    repo.getReview(job.id),
    repo.getSettings(),
  ]);
  const paid = amountPaid(payments, job.id);
  const hidePrice = actor.role === "customer" && (job.status === "scope_review" || job.status === "referred");
  const canSchedule = ["quoted", "released", "pending_area"].includes(job.status) && job.licenseLevel === "ok";
  let slots: SlotOption[] = [];
  let slotError = "";
  if (canSchedule) {
    const listed = await listOpenSlots(repo, actor, job.id);
    if (listed.ok) slots = listed.data;
    else slotError = listed.error;
  }
  const dates = [...new Set(slots.map((slot) => slot.date))];
  const selectedDate = query.date && dates.includes(query.date) ? query.date : dates[0];
  const daySlots = slots.filter((slot) => slot.date === selectedDate);
  const crewName = crews.find((crew) => crew.id === job.crewId)?.name;
  const due = job.status === "balance_due" ? job.balanceDue : job.amountDueNow;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted">{job.invoiceNumber ? `Invoice #${job.invoiceNumber}` : "No invoice yet"}</p>
          <h1 className="font-display text-3xl font-semibold text-ink">{hidePrice ? "We're reviewing your request" : job.scope || "Job"}</h1>
          <p className="text-sm text-muted">{job.jobSiteAddress}</p>
        </div>
        <Badge tone={statusTone(job.status)}>{STATUS_LABEL[job.status]}</Badge>
      </div>
      <Flash notice={query.notice} error={query.error} />

      {job.status === "scope_review" && actor.role === "customer" && (
        <Callout>
          {job.quoteMeta
            ? `Dale will review this before you can book. Plan on ${usd(job.quoteMeta.rangeLow)} to ${usd(job.quoteMeta.rangeHigh)}. You can't pay that until he confirms the job.`
            : "Part of this may need a licensed trade, so Dale is looking at it himself. We'll get back to you within 1 business day."}
        </Callout>
      )}
      {job.status === "referred" && actor.role === "customer" && (
        <Callout>
          This job needs a licensed contractor, so we can&apos;t take it.{job.referralNote ? ` ${job.referralNote}` : " We're glad to help with anything else."}
        </Callout>
      )}
      {job.status === "pending_area" && actor.role === "customer" && <Callout>{job.areaDetail} The {settings.holdHours}-hour hold starts after Dale approves the address.</Callout>}
      {job.status === "held" && job.holdUntil && (
        <Callout>
          This time is held until {new Date(job.holdUntil).toLocaleString("en-US", { timeZone: "America/Detroit", dateStyle: "medium", timeStyle: "short" })}. Pay {usd(job.amountDueNow)} to keep it.
        </Callout>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <div className="space-y-4">
          {hidePrice && job.quoteMeta && (
            <Card>
              <CardHeader>
                <CardTitle>What to plan on</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-semibold">
                  {usd(job.quoteMeta.rangeLow)} – {usd(job.quoteMeta.rangeHigh)}
                </p>
                <p className="text-muted">
                  This is not a bill yet. You can hold a time after Dale confirms the job.
                </p>
              </CardContent>
            </Card>
          )}
          {!hidePrice && (
            <Card>
              <CardHeader>
                <CardTitle>{job.quoteMeta ? "Estimate" : "Quote"}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {job.quoteMeta && <p className="text-sm text-muted">{CUSTOMER_PRICE_NOTE}</p>}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted">
                        <th className="py-1 pr-3 font-semibold">Item</th>
                        <th className="py-1 pr-3 font-semibold">Details</th>
                        <th className="py-1 text-right font-semibold">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {job.lines.map((line, index) => (
                        <tr key={`${line.label}-${index}`} className="border-t border-line">
                          <td className="py-2 pr-3">{line.label}</td>
                          <td className="py-2 pr-3 text-muted">{line.detail}</td>
                          <td className="py-2 text-right font-semibold">{usd(line.amount)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-line">
                        <td className="py-2 font-semibold">Total</td>
                        <td />
                        <td className="py-2 text-right font-semibold">{usd(job.total)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="text-sm">
                  Due to book: <strong>{usd(job.amountDueNow)}</strong> {job.balanceDue > 0 ? `(half down). Balance ${usd(job.balanceDue)} after you approve the finished work.` : "(paid in full)."}
                </p>
                {job.payRule && <p className="text-sm text-muted">{job.payRule}</p>}
                {job.assumptions.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                    {job.assumptions
                      .filter((item) => !job.quoteMeta || !item.startsWith("This is an estimate based on your description"))
                      .map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>The request</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{job.description}</p>
              <p className="text-muted">
                {job.customerName} · {job.customerPhone} · {job.customerEmail}
              </p>
              <p className="text-muted">
                {job.city} {job.jobZip} · {job.county} County · {job.areaLabel}
              </p>
              {job.scheduledDate && (
                <p>
                  {formatDate(job.scheduledDate)} at {formatMinutes(job.startMin || 0)}
                  {crewName ? ` · ${crewName}` : ""}
                  {actor.role === "owner" && job.assignedBy === "auto" ? " · assigned automatically" : actor.role === "owner" && job.assignedBy === "owner" ? " · you assigned this crew" : ""}
                </p>
              )}
              {job.assignNote && actor.role !== "customer" && <p className="text-muted">{job.assignNote}</p>}
              {job.travelLocked && <p className="text-muted">Travel stays at {job.travelMiles ?? 0} miles ({usd(job.travelFee)}) because this job is paid.</p>}
              {job.completionNote && <p>Crew note: {job.completionNote}</p>}
              {job.problemNote && <p>Problem: {job.problemNote}</p>}
              {actor.role === "owner" && job.quoteMeta && (
                <div className="rounded-md border border-line bg-paper p-3">
                  <p className="font-semibold">How this estimate was built</p>
                  {job.quoteMeta.reasoning && <p className="mt-1">{job.quoteMeta.reasoning}</p>}
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                    {job.quoteMeta.items.map((item) => (
                      <li key={item.id}>
                        {item.name}: {item.quantity} {item.unit} × {usd(item.unitHigh)} high ({item.basis}
                        {item.discount > 0 ? `, minus ${Math.round(item.discount * 100)}%` : ""}) = {usd(item.amount)}
                      </li>
                    ))}
                  </ul>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">
                    {job.quoteMeta.math.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                  {job.quoteMeta.referralEstimate != null && (
                    <p className="mt-2">Your working number: {usd(job.quoteMeta.referralEstimate)}. The customer sees {usd(job.quoteMeta.rangeLow)} to {usd(job.quoteMeta.rangeHigh)} until you release the quote.</p>
                  )}
                </div>
              )}
              {actor.role === "owner" && job.licenseLevel !== "ok" && (
                <div className="rounded-md bg-copper/10 p-3">
                  <p className="font-semibold">{job.licenseTrade}</p>
                  <p>{job.licenseWhy}</p>
                  <p className="text-muted">{job.licenseRule}</p>
                </div>
              )}
              {job.photos.length > 0 && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {job.photos.map((photo) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={photo.id} src={`/api/photos/${photo.id}`} alt={photo.name} className="h-28 w-full rounded-md object-cover" />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {canSchedule && (
            <Card>
              <CardHeader>
                <CardTitle>Pick a time</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {slots.length === 0 ? (
                  <p className="text-sm text-muted">{slotError || "Nothing in the next two weeks fits this job and the drive."}</p>
                ) : (
                  <>
                    <form action={holdSlotAction}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <input type="hidden" name="when" value="earliest" />
                      <SubmitButton>Earliest available · {formatDate(slots[0].date)} at {formatMinutes(slots[0].startMin)}</SubmitButton>
                    </form>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {dates.map((date) => (
                        <a
                          key={date}
                          href={`/jobs/${job.id}?date=${date}`}
                          className={date === selectedDate ? "shrink-0 rounded-full bg-pine px-3 py-1 text-sm font-semibold text-white" : "shrink-0 rounded-full border border-line bg-card px-3 py-1 text-sm"}
                        >
                          {formatDate(date)}
                        </a>
                      ))}
                    </div>
                    <div className="grid gap-2">
                      {daySlots.map((slot) => (
                        <form key={`${slot.date}-${slot.startMin}-${slot.crewId}`} action={holdSlotAction} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm">
                          <input type="hidden" name="jobId" value={job.id} />
                          <input type="hidden" name="date" value={slot.date} />
                          <input type="hidden" name="startMin" value={slot.startMin} />
                          <div>
                            <p className="font-semibold">{formatMinutes(slot.startMin)} · {slot.crewName}</p>
                            <p className="text-muted">
                              {slot.memberNames.join(", ")} · {slot.travelMiles.toFixed(1)} miles from {slot.travelFrom} · travel {usd(slot.travelFee)}
                            </p>
                          </div>
                          <SubmitButton size="sm" variant="outline">Hold {usd(slot.dueNow)}</SubmitButton>
                        </form>
                      ))}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Payment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>Paid so far: {usd(paid)}</p>
              {(job.status === "held" || job.status === "balance_due") && (
                <div className="space-y-2">
                  <p className="font-semibold">Due now: {usd(due)}</p>
                  {paypalConfigured() ? (
                    <form action={startPayPalAction}>
                      <input type="hidden" name="jobId" value={job.id} />
                      <SubmitButton>Pay with PayPal</SubmitButton>
                    </form>
                  ) : (
                    actor.role !== "worker" && (
                      <form action={demoPayAction}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <SubmitButton variant="copper">Record a test payment</SubmitButton>
                        <p className="mt-1 text-xs text-muted">PayPal isn&apos;t connected on this copy yet. This marks the invoice paid without charging a card.</p>
                      </form>
                    )
                  )}
                  {actor.role === "owner" && (
                    <div className="flex flex-wrap gap-2">
                      <form action={manualPayAction}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="method" value="cash" />
                        <SubmitButton variant="outline" size="sm">Mark cash paid</SubmitButton>
                      </form>
                      <form action={manualPayAction}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="method" value="check" />
                        <SubmitButton variant="outline" size="sm">Mark check paid</SubmitButton>
                      </form>
                    </div>
                  )}
                </div>
              )}
              {payments.length === 0 ? (
                <p className="text-muted">No payments yet.</p>
              ) : (
                <ul className="space-y-2">
                  {payments.map((payment) => (
                    <PaymentRow key={payment.id} payment={payment} jobId={job.id} owner={actor.role === "owner"} />
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {job.status === "held" || (job.status === "pending_area" && job.scheduledDate) ? (
            <form action={releaseHoldAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <SubmitButton variant="outline">Release this hold</SubmitButton>
            </form>
          ) : null}

          {job.status === "booked" && (actor.role === "customer" || actor.role === "owner") && (
            <Card>
              <CardHeader>
                <CardTitle>Before work starts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>Cancel or reschedule before work starts and we keep {usd(settings.cancelFee)}. If you paid that amount or less, the refund is $0.</p>
                <div className="flex flex-wrap gap-2">
                  <form action={cancelAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <input type="hidden" name="kind" value="cancel" />
                    <SubmitButton variant="danger" size="sm">Cancel</SubmitButton>
                  </form>
                  <form action={cancelAction}>
                    <input type="hidden" name="jobId" value={job.id} />
                    <input type="hidden" name="kind" value="reschedule" />
                    <SubmitButton variant="outline" size="sm">Reschedule</SubmitButton>
                  </form>
                </div>
              </CardContent>
            </Card>
          )}

          {["in_progress", "awaiting_approval", "balance_due", "disputed"].includes(job.status) && (actor.role === "customer" || actor.role === "owner") && (
            <form action={requestCancelAction} className="space-y-2">
              <input type="hidden" name="jobId" value={job.id} />
              <p className="text-sm text-muted">Work has started, so Dale has to approve a cancellation. He enters any refund himself.</p>
              <SubmitButton variant="outline">Request cancellation</SubmitButton>
            </form>
          )}

          {(actor.role === "worker" || actor.role === "owner") && job.status === "booked" && (
            <form action={startWorkAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <SubmitButton>Start work</SubmitButton>
            </form>
          )}
          {(actor.role === "worker" || actor.role === "owner") && job.status === "in_progress" && (
            <form action={completeWorkAction} className="space-y-2">
              <input type="hidden" name="jobId" value={job.id} />
              <Textarea name="note" placeholder="What the crew finished" />
              <SubmitButton>Mark the job done</SubmitButton>
            </form>
          )}

          {job.status === "awaiting_approval" && (actor.role === "customer" || actor.role === "owner") && (
            <Card>
              <CardHeader>
                <CardTitle>Approve the work</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <form action={approveWorkAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <SubmitButton>The work looks right</SubmitButton>
                </form>
                <form action={reportProblemAction} className="space-y-2">
                  <input type="hidden" name="jobId" value={job.id} />
                  <Textarea name="note" required placeholder="What needs another look" />
                  <SubmitButton variant="outline">Report a problem</SubmitButton>
                </form>
              </CardContent>
            </Card>
          )}

          {(job.status === "completed" || job.status === "reviewed") && actor.role === "customer" && (
            <Card>
              <CardHeader>
                <CardTitle>Review</CardTitle>
              </CardHeader>
              <CardContent>
                {review ? (
                  <p className="text-sm">{review.rating} of 5. {review.comment}</p>
                ) : (
                  <form action={reviewAction} className="space-y-2">
                    <input type="hidden" name="jobId" value={job.id} />
                    <label className="grid gap-1 text-sm font-semibold">
                      Rating
                      <select name="rating" className="h-10 rounded-md border border-line bg-card px-3" defaultValue="5">
                        {[5, 4, 3, 2, 1].map((star) => (
                          <option key={star} value={star}>{star} of 5</option>
                        ))}
                      </select>
                    </label>
                    <Textarea name="comment" placeholder="How did the job go?" />
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" name="publishPhotos" /> eX Construction can show my photos with this review
                    </label>
                    <SubmitButton>Save review</SubmitButton>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          {actor.role === "owner" && <OwnerTools job={job} crews={crews.filter((crew) => crew.active)} />}
        </div>
      </div>
    </div>
  );
}

function paymentLabel(kind: PaymentRecord["kind"]): string {
  if (kind === "deposit") return "Deposit";
  if (kind === "balance") return "Balance";
  if (kind === "refund") return "Refund";
  return "Payment";
}

function methodLabel(method: PaymentRecord["method"]): string {
  if (method === "paypal") return "PayPal";
  if (method === "check") return "Check";
  return "Cash";
}

function Callout({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-copper/30 bg-copper/10 px-3 py-2 text-sm">{children}</p>;
}

function PaymentRow({ payment, jobId, owner }: { payment: PaymentRecord; jobId: string; owner: boolean }) {
  return (
    <li className="rounded-md border border-line px-2 py-1.5">
      <p>
        {paymentLabel(payment.kind)} · {usd(payment.amount)} · {methodLabel(payment.method)} · {payment.status === "paid" ? "paid" : payment.status === "pending" ? "pending" : payment.status === "sent" ? "sent" : payment.status}
        {payment.closed ? " · closed" : ""}
      </p>
      {payment.note && <p className="text-muted">{payment.note}</p>}
      {owner && payment.kind === "refund" && payment.status === "pending" && (
        <form action={markRefundAction} className="mt-1">
          <input type="hidden" name="jobId" value={jobId} />
          <input type="hidden" name="paymentId" value={payment.id} />
          <SubmitButton size="sm" variant="outline">Mark refund sent</SubmitButton>
        </form>
      )}
    </li>
  );
}

function OwnerTools({ job, crews }: { job: JobRecord; crews: { id: string; name: string }[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Owner tools</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {job.status === "scope_review" && (
          <div className="space-y-2">
            <p>
              {job.quoteMeta
                ? `Your number: ${usd(job.total)}. The customer sees ${usd(job.quoteMeta.rangeLow)} to ${usd(job.quoteMeta.rangeHigh)} until you release the quote.`
                : `Draft total, hidden from the customer: ${usd(job.total)}`}
            </p>
            <form action={releaseLicenseAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <SubmitButton size="sm">We can do this. Release the quote</SubmitButton>
            </form>
          </div>
        )}
        {(job.status === "scope_review" || job.status === "pending_area") && (
          <form action={referOutAction} className="space-y-2">
            <input type="hidden" name="jobId" value={job.id} />
            <Textarea name="note" placeholder="Referral note to the customer" />
            <SubmitButton size="sm" variant="outline">Refer out</SubmitButton>
          </form>
        )}
        {job.status === "pending_area" && (
          <div className="flex flex-wrap gap-2">
            <form action={decideAreaAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="decision" value="approve" />
              <SubmitButton size="sm">Approve this address</SubmitButton>
            </form>
            <form action={decideAreaAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="decision" value="decline" />
              <SubmitButton size="sm" variant="outline">Decline</SubmitButton>
            </form>
          </div>
        )}
        {job.status === "cancel_requested" && (
          <div className="space-y-2">
            <p>Work already started. Type the refund. An empty box will not approve the cancellation.</p>
            <form action={resolveCancelAction} className="space-y-2">
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="decision" value="approve" />
              <Input name="refund" inputMode="decimal" aria-label="Refund amount in dollars" />
              <SubmitButton size="sm" variant="danger">Approve cancellation</SubmitButton>
            </form>
            <form action={resolveCancelAction}>
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="decision" value="decline" />
              <SubmitButton size="sm" variant="outline">Decline request</SubmitButton>
            </form>
          </div>
        )}
        {job.status === "disputed" && (
          <form action={resumeProblemAction}>
            <input type="hidden" name="jobId" value={job.id} />
            <SubmitButton size="sm" variant="outline">Clear the problem and continue</SubmitButton>
          </form>
        )}
        {job.scheduledDate && job.crewId && (
          <form action={reassignAction} className="space-y-2">
            <input type="hidden" name="jobId" value={job.id} />
            <label className="grid gap-1 font-semibold">
              Reassign crew
              <select name="crewId" defaultValue={job.crewId} className="h-10 rounded-md border border-line bg-card px-3 font-normal">
                {crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>{crew.name}</option>
                ))}
              </select>
            </label>
            <p className="text-muted">{job.travelLocked ? "Paid travel stays as it is." : "Unpaid travel will be measured again from the new crew's previous stop."}</p>
            <SubmitButton size="sm" variant="outline">Save crew</SubmitButton>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
