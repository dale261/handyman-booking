import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getRepository } from "@/lib/db/index";
import { usd } from "@/lib/format";

export default async function HomePage() {
  const repo = getRepository();
  const [settings, reviews] = await Promise.all([repo.getSettings(), repo.listReviews()]);
  const published = reviews.filter((review) => review.comment || review.rating);
  const counties = settings.premiumCounties.join(", ");

  return (
    <div className="space-y-10">
      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-end">
        <div className="space-y-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-copper">Cadillac, Michigan</p>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-pine sm:text-5xl">Handyman work, priced before anyone drives out.</h1>
          <p className="max-w-xl text-lg text-ink/80">
            eX Construction is Dale Orvis&apos;s crew in Cadillac. Tell us the job and you&apos;ll see a price before we drive out. Clear jobs can be booked right away. If we need a closer look, Dale will review it first. Your time is held for {settings.holdHours} hours while you pay.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/book" className="inline-flex h-12 items-center rounded-md bg-pine px-6 font-semibold text-paper">
              Get a quote
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
            <p>Painting, including large jobs. House cleaning. TV mounting and window coverings. Furniture assembly. Hire a helper.</p>
            <p className="text-muted">Other handyman work can be priced from what you describe. If the job is unclear, or it needs a license, Dale will review it before you can book.</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>1. Describe it</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">Add your name, phone, and billing address. Photos help if you have them.</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2. See the price</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">
            You&apos;ll see the work, materials, travel, and any area charge on separate lines. Under {usd(settings.depositThreshold)} is paid in full. That amount or more is half down.
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>3. Hold a time</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted">
            Pick a time, or take the earliest opening. It stays yours for {settings.holdHours} hours while you pay. Cancel before work starts and we keep {usd(settings.cancelFee)}.
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Travel and the area charge</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              Travel is {usd(settings.mileRate)} per mile, one way, with a {usd(settings.travelMinimum)} minimum. The first job of the day is measured from the shop at {settings.shopAddress}. Later jobs are measured from the stop before. Once you pay, that travel charge stays put.
            </p>
            <p>
              Jobs in {counties} include a {Math.round((settings.premiumMultiplier - 1) * 100)}% area charge on the work, including helpers. The drive is not part of that charge.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Hire a helper</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {usd(settings.helperRate)} per hour, per person. One hour minimum. Up to {settings.helperMax} helpers. The area charge applies to helper time. Travel is charged once, not per person.
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
