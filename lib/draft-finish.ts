import "server-only";
import type { Repository } from "@/lib/db/repository";
import type { Actor } from "@/lib/db/types";
import { clearDraftCookie, readDraftCookie } from "@/lib/draft-cookie";
import { jobSiteAddress } from "@/lib/domain/draft";
import { DEFAULT_PARAMS } from "@/lib/domain/types";
import { flushEmails } from "@/lib/email";
import { createQuote } from "@/lib/services/booking";

/**
 * A visitor who priced a job before signing up has a draft in a cookie.
 * Turn it into a real quote now and send them to that job. Returns the
 * page to go to, or null when there is nothing to finish. Used after
 * sign-up, sign-in, and the emailed confirmation link.
 */
export async function finishDraft(repo: Repository, actor: Actor): Promise<string | null> {
  const draft = await readDraftCookie();
  if (!draft) return null;
  await clearDraftCookie();
  if (actor.role !== "customer") return null;
  const result = await createQuote(repo, actor, {
    service: draft.service,
    description: draft.description,
    params: { ...DEFAULT_PARAMS, ...draft.params },
    differentSite: true,
    jobSiteAddress: jobSiteAddress(draft),
    urgent: draft.urgent,
    pickup: draft.pickup,
    preferredWorkerId: null,
    photos: [],
  });
  await flushEmails(repo).catch((error) => console.error("[email] flush failed", error));
  if (!result.ok) return "/book?error=" + encodeURIComponent(result.error);
  if (draft.leadId) {
    const lead = await repo.getLead(draft.leadId);
    if (lead && !lead.jobId) await repo.saveLead({ ...lead, jobId: result.data.id, updatedAt: new Date().toISOString() });
  }
  return `/jobs/${result.data.id}`;
}
