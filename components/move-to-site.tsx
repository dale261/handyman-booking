"use client";

import { useState, type MouseEvent } from "react";
import { siteFromBilling } from "@/lib/domain/paste-fill";

/**
 * Add a job, under the billing address: one tap moves that address (and its ZIP) down to
 * the job site address and empties the billing boxes. For when the only address the owner
 * has is where the work is. Nothing is saved until Add the job.
 */
export function MoveToSite() {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  function move(event: MouseEvent<HTMLButtonElement>) {
    const form = event.currentTarget.closest("form");
    if (!form) return;
    const billing = form.elements.namedItem("billingAddress");
    const zip = form.elements.namedItem("billingZip");
    const site = form.elements.namedItem("jobSiteAddress");
    if (!(billing instanceof HTMLInputElement) || !(zip instanceof HTMLInputElement) || !(site instanceof HTMLInputElement)) return;
    const moved = siteFromBilling(billing.value, zip.value);
    if (!moved) {
      setNote({ ok: false, text: "There's no billing address to move." });
      return;
    }
    if (site.value.trim() && site.value.trim() !== moved) {
      setNote({ ok: false, text: "The job site address already has something in it. Clear that box first." });
      return;
    }
    site.value = moved;
    billing.value = "";
    zip.value = "";
    setNote({ ok: true, text: "Moved. It's now the job site address, under The work." });
  }

  return (
    <div className="grid gap-1 text-sm sm:col-span-2">
      <div>
        <button type="button" onClick={move} className="h-10 rounded-md border border-pine px-4 text-sm font-semibold text-pine">
          Move address to job site
        </button>
      </div>
      <span className={note ? (note.ok ? "text-pine" : "text-red-700") : "text-muted"}>
        {note ? note.text : "Use this when the address is where the work is, not where the bill goes."}
      </span>
    </div>
  );
}
