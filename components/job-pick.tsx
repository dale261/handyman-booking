"use client";

import { useState, type ReactNode } from "react";
import type { JobChoice } from "@/lib/domain/job-pick";

/** The line shown in the job list: the work, then the street, short enough for a phone. */
function jobLine(job: JobChoice): string {
  const work = job.scope.length > 44 ? `${job.scope.slice(0, 43)}…` : job.scope;
  const street = job.where.split(",")[0].trim();
  return street ? `${work} · ${street}` : work;
}

/**
 * A job list for a form. Once a job is picked, a box under the list spells it out (the
 * work, the address, the day) so the right one is easy to tell. Sends the job as `jobId`.
 */
export function JobPick({ jobs, label, blank, required }: { jobs: JobChoice[]; label: ReactNode; blank: string; required?: boolean }) {
  const [jobId, setJobId] = useState("");
  const picked = jobs.find((job) => job.id === jobId);
  return (
    <>
      {/* A list box is as wide as its longest line. Without these limits a long job name pushes the whole page wider than a phone. */}
      <label className="grid min-w-0 grid-cols-1 gap-1 font-semibold sm:col-span-2">
        {label}
        <select name="jobId" value={jobId} required={required} onChange={(event) => setJobId(event.target.value)} className="h-10 w-full min-w-0 rounded-md border border-line bg-card px-3 font-normal">
          <option value="" disabled={required}>
            {blank}
          </option>
          {jobs.map((job) => (
            <option key={job.id} value={job.id}>
              {jobLine(job)}
            </option>
          ))}
        </select>
      </label>
      {picked && (
        <div className="min-w-0 rounded-md border border-line bg-paper px-3 py-2 break-words sm:col-span-2">
          <p className="text-muted">Check it&apos;s the right job:</p>
          <p className="font-semibold">{picked.scope}</p>
          {picked.where && <p>{picked.where}</p>}
          <p>{picked.when}</p>
        </div>
      )}
    </>
  );
}
