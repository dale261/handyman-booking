import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRepository } from "@/lib/db/index";
import { directBookingBlurb } from "@/lib/domain/direct-booking";
import { usd } from "@/lib/format";

export default async function HomePage() {
  const repo = getRepository();
  const [settings, reviews] = await Promise.all([repo.getSettings(), repo.listReviews()]);
  const published = reviews.filter((review) => review.comment || review.rating);

  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-pine">Cadillac, Michigan</p>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-ink sm:text-5xl">Handyman work, instant quoting and scheduling.</h1>
          <p className="max-w-xl text-lg text-ink/80">
            eX Construction is a handyman crew out of Cadillac, MI. Try our quoting tool, approve the price and time, and let us handle the rest. Clear jobs can be booked right away. If we need a closer look, or the job requires additional licensing, we&apos;ll review it first and get back to you promptly with a resolution or a referral. Great work starts here.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/book" className="inline-flex h-12 items-center rounded-md bg-pine px-6 font-semibold text-white">
              See your price
            </Link>
            <Link href="/signup" className="inline-flex h-12 items-center rounded-md border border-line bg-card px-6 font-semibold">
              Create an account
            </Link>
          </div>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>What we book directly</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{directBookingBlurb()}</p>
            <p className="text-muted">Other handyman work can be priced from what you describe. If the job is unclear, or it needs a license, we&apos;ll review it before you can book.</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>1. Describe it</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Pick the job, answer a few questions, and add the address and your phone. Just a name and number to see the price; the account comes when you book.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2. See the price</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">
            One firm price, with the work, materials, travel, and any area charge on separate lines. Under {usd(settings.depositThreshold)} is paid in full. That amount or more requires half down.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>3. Hold a time</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">
            Create your account, then pick a time or take the earliest opening. It stays yours for {settings.holdHours} hours while you pay. Cancel before work starts and we keep {usd(settings.cancelFee)}. If we find something different on site, you can approve a new price or get refunded everything except travel.
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-semibold">Recent reviews</h2>
        {published.length === 0 ? (
          <p className="text-sm text-muted">No reviews yet. After a job is paid, you can leave one.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {published.slice(0, 4).map((review) => (
              <Card key={review.jobId}>
                <CardContent className="space-y-2">
                  <Badge tone="ok">{review.rating} of 5</Badge>
                  <p>{review.comment || "Left a rating."}</p>
                  <p className="text-sm text-muted">{review.customerName}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
