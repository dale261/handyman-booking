import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { signOffAction } from "@/lib/actions";
import { Flash } from "@/components/flash";
import { SubmitButton } from "@/components/submit-button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { requireActor } from "@/lib/auth";
import { getRepository } from "@/lib/db/index";
import { visibleTo } from "@/lib/services/booking";

// The tab title too: nothing on this screen names eX Construction.
export const metadata: Metadata = { title: "Work sign-off" };

/**
 * The screen a crew member hands to whoever is on site, on the crew's own phone.
 * It shows only what was done and where: no price, no customer account, and no
 * eX Construction name, so it suits a white-label job as well as any other.
 */
export default async function SignOffPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const actor = await requireActor();
  const repo = getRepository();
  const job = await repo.getJob(id);
  if (!job || !(await visibleTo(repo, actor, job))) notFound();
  if (actor.role === "customer") redirect(`/jobs/${job.id}`);

  if (query.done) {
    return (
      <div className="mx-auto max-w-md space-y-4 py-10 text-center">
        <h1 className="font-display text-3xl font-semibold text-ink">Thank you</h1>
        <p>Your sign-off is recorded. Please hand the phone back.</p>
        <p className="pt-6 text-sm">
          <Link className="font-semibold text-pine underline" href={`/jobs/${job.id}`}>
            Back to the job
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-5 py-4">
      <div>
        <h1 className="font-display text-3xl font-semibold text-ink">Work sign-off</h1>
        <p className="text-sm text-muted">{job.jobSiteAddress}</p>
      </div>
      <Flash error={query.error} />
      <div className="rounded-md border border-line bg-card px-4 py-3 text-sm">
        <p className="font-semibold">Work completed</p>
        <p>{job.scope || job.description}</p>
        {job.completionNote && <p className="mt-1 text-muted">{job.completionNote}</p>}
      </div>
      <form action={signOffAction} className="space-y-4 text-sm">
        <input type="hidden" name="jobId" value={job.id} />
        <label className="grid gap-1 font-semibold">
          Your name
          <Input name="name" required minLength={2} maxLength={80} autoComplete="off" />
        </label>
        <label className="grid gap-1 font-semibold">
          Your title <span className="font-normal text-muted">(optional)</span>
          <Input name="title" maxLength={60} autoComplete="off" placeholder="Store manager" />
        </label>
        <label className="grid gap-1 font-semibold">
          Anything to add <span className="font-normal text-muted">(optional)</span>
          <Textarea name="note" maxLength={500} />
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" name="agree" required className="mt-1" />
          <span>To my knowledge, this work was completed properly.</span>
        </label>
        <SubmitButton pendingLabel="Saving…">Sign off</SubmitButton>
      </form>
      <p className="text-sm">
        <Link className="text-muted underline" href={`/jobs/${job.id}`}>
          Cancel
        </Link>
      </p>
    </div>
  );
}
