import { NextResponse } from "next/server";
import { currentActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { flushEmails } from "@/lib/email";
import { appUrl } from "@/lib/format";
import { capturePayPalOrder } from "@/lib/paypal";
import { allowRequest, ANON_LIMIT } from "@/lib/rate-limit";
import { payJob } from "@/lib/services/booking";

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
  if (!actor) return NextResponse.redirect(`${appUrl()}/login?next=${encodeURIComponent(`/jobs/${jobId}`)}`);
  if (!jobId || !orderId) return back("error", "PayPal did not return an order.");

  const repo = getRepository();
  const job = await repo.getJob(jobId);
  if (!job) return back("error", "Job not found.");
  if (actor.role === "customer" && job.customerId !== actor.id) return back("error", "That job belongs to another customer.");
  if (job.paypalOrderId && job.paypalOrderId !== orderId) return back("error", "That PayPal order does not match this invoice.");

  try {
    const capture = await capturePayPalOrder(orderId);
    const expected = job.status === "held" ? job.amountDueNow : job.status === "balance_due" ? job.balanceDue : 0;
    if (expected <= 0) return back("error", "Nothing is due on this job right now.");
    if (Math.abs(capture.amount - expected) > 0.02) {
      return back("error", `PayPal charged ${capture.amount.toFixed(2)}, which does not match the ${expected.toFixed(2)} due. The payment was not applied.`);
    }
    if (capture.status && capture.status !== "COMPLETED") return back("error", "PayPal did not complete the payment.");
    const result = await payJob(repo, actor, jobId, "paypal", capture.captureId);
    await flushEmails(repo).catch((error) => console.error("[email] flush failed", error));
    if (!result.ok) return back("error", result.error);
    return back("notice", "PayPal payment received. You're booked.");
  } catch (error) {
    const message = error instanceof Error ? error.message : "PayPal capture failed.";
    return back("error", message);
  }
}
