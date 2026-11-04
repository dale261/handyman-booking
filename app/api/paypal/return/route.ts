import { NextResponse } from "next/server";
import { currentActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { flushEmails } from "@/lib/email";
import { appUrl, usd } from "@/lib/format";
import { capturePayPalOrder, getPayPalOrder } from "@/lib/paypal";
import { allowRequest, ANON_LIMIT } from "@/lib/rate-limit";
import { amountPayable, notify, payJob } from "@/lib/services/booking";

/**
 * Where PayPal sends the customer after they approve the payment.
 *
 * Order of operations matters: everything that could reject the payment is
 * checked BEFORE the capture call, so a rejected return never leaves the
 * customer charged with nothing recorded. The capture is the last step, and
 * a refreshed or repeated return finds the order already captured and records
 * that same capture once.
 */
export async function GET(request: Request) {
  if (!(await allowRequest(ANON_LIMIT, request.headers))) {
    return NextResponse.redirect(
      `${appUrl()}/login?error=${encodeURIComponent("Too many attempts from this network. Wait a few minutes and try again.")}`,
    );
  }
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job") || "";
  const orderId = url.searchParams.get("token") || "";
  const back = (kind: "notice" | "error", message: string) => NextResponse.redirect(`${appUrl()}/jobs/${jobId}?${kind}=${encodeURIComponent(message)}`);

  const actor = await currentActor();
  if (!actor) return NextResponse.redirect(`${appUrl()}/login?next=${encodeURIComponent(`/api/paypal/return?job=${jobId}&token=${orderId}`)}`);
  if (!jobId || !orderId) return back("error", "PayPal didn't send an order back. Nothing was charged.");

  const repo = getRepository();
  const job = await repo.getJob(jobId);
  if (!job) return back("error", "Job not found. Nothing was charged.");
  if (actor.role === "customer" && job.customerId !== actor.id) return back("error", "That job belongs to another customer. Nothing was charged.");
  if (job.paypalOrderId && job.paypalOrderId !== orderId) return back("error", "That PayPal checkout doesn't match this invoice. Nothing was charged.");

  try {
    const order = await getPayPalOrder(orderId);

    // Already captured: the customer refreshed this page or came back twice. Record it once, charge nothing more.
    if (order.status === "COMPLETED" && order.captureId) {
      const result = await payJob(repo, actor, jobId, "paypal", order.captureId);
      await flushEmails(repo).catch((error) => console.error("[email] flush failed", error));
      if (!result.ok) return back("error", result.error);
      return back("notice", "Payment received.");
    }

    const expected = amountPayable(job);
    if (expected <= 0) return back("error", "Nothing is due on this job right now, so we didn't take the PayPal payment.");
    if (job.status === "held" && job.holdUntil && new Date(job.holdUntil).getTime() <= Date.now()) {
      return back("error", "That hold ran out before the payment went through, so nothing was charged. Pick a new time and pay again.");
    }
    if (Math.abs(order.amount - expected) > 0.02) {
      return back(
        "error",
        `That PayPal checkout was for ${usd(order.amount)}, but ${usd(expected)} is due now, so nothing was charged. Start the payment again.`,
      );
    }
    if (order.status !== "APPROVED") {
      return back("error", "PayPal didn't finish approving the payment, so nothing was charged. Try again.");
    }

    const capture = await capturePayPalOrder(orderId);
    if (capture.status === "DECLINED" || capture.status === "FAILED") {
      return back("error", "PayPal declined the payment. Nothing was charged. Try another way to pay.");
    }
    const alreadyBooked = job.status === "booked";
    const result = await payJob(repo, actor, jobId, "paypal", capture.captureId, {
      note: capture.status === "PENDING" ? "PayPal shows this payment as pending. Check PayPal before the work starts." : undefined,
    });
    await flushEmails(repo).catch((error) => console.error("[email] flush failed", error));
    if (!result.ok) {
      // Money moved but the job couldn't take it (a race with an expiring hold, say). Tell the owner so it gets matched or refunded.
      console.error("[paypal] captured but not recorded", { jobId, orderId, captureId: capture.captureId, error: result.error });
      const settings = await repo.getSettings();
      await notify(
        repo,
        settings,
        "pay",
        `PayPal payment needs matching: ${usd(capture.amount)} on invoice #${job.invoiceNumber ?? "?"}`,
        `${job.customerName} (${job.customerPhone}) paid ${usd(capture.amount)} by PayPal (capture ${capture.captureId}), but the job couldn't record it: ${result.error} Match it to the job or refund it in PayPal.`,
        job.id,
      );
      await flushEmails(repo).catch((error) => console.error("[email] flush failed", error));
      return back("error", `${result.error} Your PayPal payment did go through, and we'll match it to this invoice.`);
    }
    return back("notice", alreadyBooked ? "Payment received." : "Payment received. You're booked.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "PayPal capture failed.";
    return back("error", message);
  }
}
