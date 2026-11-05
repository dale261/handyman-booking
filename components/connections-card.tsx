import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { resendConfigured } from "@/lib/email";
import { checkPayPalKeys } from "@/lib/paypal";

/**
 * Owner-only: is the site able to take money and send email right now?
 * Answers the question without running a test payment.
 */
export async function ConnectionsCard() {
  const paypal = await checkPayPalKeys();
  const email = resendConfigured();
  const allGood = paypal.ok && paypal.mode === "live" && email;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Is the site ready to take bookings?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <Row
          label="PayPal"
          tone={paypal.ok ? (paypal.mode === "live" ? "ok" : "wait") : "stop"}
          status={paypal.ok ? (paypal.mode === "live" ? "Live" : "Test mode") : "Not working"}
          detail={paypal.detail}
        />
        <Row
          label="Email"
          tone={email ? "ok" : "stop"}
          status={email ? "Connected" : "Not connected"}
          detail={email ? "Customers get their hold, receipt, and finished-work emails." : "No Resend key in Vercel. Emails pile up in the Queue instead of sending."}
        />
        {allGood ? (
          <p className="text-muted">
            Everything a customer needs is on. To watch a payment go through once, stay signed in as yourself:{" "}
            <Link className="font-semibold text-pine underline" href="/owner/jobs/new">
              Add a job
            </Link>{" "}
            with your own name and phone, any email other than your sign-in, and a price of $1. Open it, hold a time, tap Pay with PayPal, pay with a card or a personal PayPal account, then tap Refund on the job page. No customer account needed.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function Row({ label, tone, status, detail }: { label: string; tone: "ok" | "wait" | "stop"; status: string; detail: string }) {
  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
      <span className="w-16 font-semibold">{label}</span>
      <Badge tone={tone}>{status}</Badge>
      <span className="basis-full text-muted sm:basis-auto sm:flex-1">{detail}</span>
    </div>
  );
}
