"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensureCustomerAccount } from "@/lib/accounts";
import { clearLocalSession, createSupabaseServer, currentActor, homeFor, requireActor, requireRole, safeNext, setLocalSession } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { sendAgreement, signAgreement } from "@/lib/services/agreement";
import { createOwnerJob, OWNER_JOB_LIMITS } from "@/lib/services/owner-jobs";
import { areaCheck } from "@/lib/domain/area";
import { DEMO_PAY_UNAVAILABLE, demoSignInAllowed } from "@/lib/demo";
import { getRepository, supabaseConfigured } from "@/lib/db/index";
import { allowRequest, ANON_LIMIT, LEAD_LIMIT, QUOTE_LIMIT } from "@/lib/rate-limit";
import { DEMO_USERS } from "@/lib/db/local";
import type { Repository } from "@/lib/db/repository";
import { actorFromUser, type Actor, type CrewRecord, type Role, type WorkerRecord } from "@/lib/db/types";
import { clearDraftCookie, readDraftCookie, writeDraftCookie } from "@/lib/draft-cookie";
import { jobSiteAddress, parseDraft } from "@/lib/domain/draft";
import { mergeLibrary } from "@/lib/domain/library";
import type { LibraryGroup } from "@/lib/domain/library-data";
import { normalizeSettings, SETTING_FIELDS } from "@/lib/domain/settings";
import type { QuoteParams, ServiceId, Settings } from "@/lib/domain/types";
import { DEFAULT_PARAMS, SERVICE_LABELS } from "@/lib/domain/types";
import { flushEmails, resendConfigured } from "@/lib/email";
import { hashPassword, verifyPassword } from "@/lib/password";
import { consumeLocalResetToken, issueLocalResetToken } from "@/lib/password-reset";
import { createPayPalOrder } from "@/lib/paypal";
import { appUrl, formatDate, formatDateRange, formatMinutes } from "@/lib/format";
import { blocksSchedule, jobDates } from "@/lib/domain/scheduling";
import { publicEstimate, recentLeadForPhone, recordLead, type PublicEstimate } from "@/lib/services/estimate";
import {
  amountPayable,
  approveWork,
  cancelBeforeWork,
  cancelOnSite,
  completeWork,
  createQuote,
  decideArea,
  decidePriceChange,
  holdSlot,
  markRefundSent,
  payJob,
  proposePriceChange,
  reassignCrew,
  referOut,
  releaseHold,
  releaseLicense,
  reportProblem,
  requestCancel,
  resolveCancel,
  resumeAfterProblem,
  saveReview,
  startWork,
} from "@/lib/services/booking";

function field(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

function jobBack(id: string, kind: "notice" | "error", message: string): never {
  redirect(`/jobs/${id}?${kind}=${encodeURIComponent(message)}`);
}

async function settle(repo: Repository) {
  await flushEmails(repo).catch((error) => console.error("[email] flush failed", error));
}

async function mutate(jobId: string, notice: string, work: (repo: Repository, actor: Actor) => Promise<{ ok: true } | { ok: false; error: string }>) {
  const actor = await requireActor();
  const repo = getRepository();
  const result = await work(repo, actor);
  await settle(repo);
  if (!result.ok) jobBack(jobId, "error", result.error);
  jobBack(jobId, "notice", notice);
}

/**
 * A visitor who priced a job before signing up has a draft in a cookie.
 * Turn it into a real quote now and send them to that job. Returns the
 * page to go to, or null when there is nothing to finish.
 */
async function finishDraft(repo: Repository, actor: Actor): Promise<string | null> {
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
  await settle(repo);
  if (!result.ok) return "/book?error=" + encodeURIComponent(result.error);
  if (draft.leadId) {
    const lead = await repo.getLead(draft.leadId);
    if (lead && !lead.jobId) await repo.saveLead({ ...lead, jobId: result.data.id, updatedAt: new Date().toISOString() });
  }
  return `/jobs/${result.data.id}`;
}

export async function signUp(form: FormData) {
  if (!(await allowRequest(ANON_LIMIT))) {
    redirect("/signup?error=" + encodeURIComponent("Too many attempts from this network. Wait a few minutes and try again."));
  }
  const fullName = field(form, "fullName");
  const email = field(form, "email").toLowerCase();
  const phone = field(form, "phone");
  const billingAddress = field(form, "billingAddress");
  const billingZip = field(form, "billingZip");
  const password = String(form.get("password") ?? "");
  if (!fullName || !email || !phone || !billingAddress) {
    redirect("/signup?error=" + encodeURIComponent("Name, email, phone, and billing address are required."));
  }
  if (!/^\d{5}$/.test(billingZip)) redirect("/signup?error=" + encodeURIComponent("Billing ZIP must be 5 digits."));
  if (password.length < 8) redirect("/signup?error=" + encodeURIComponent("Use a password of at least 8 characters."));

  const repo = getRepository();
  if (supabaseConfigured()) {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName, phone, billing_address: billingAddress, billing_zip: billingZip } },
    });
    if (error || !data.user) {
      redirect("/signup?error=" + encodeURIComponent(error?.message || "Could not create the account."));
    }
    if (!data.session) {
      redirect("/login?notice=" + encodeURIComponent("Check your email to confirm the account. If no message arrives, let us know."));
    }
    const existing = await repo.getUser(data.user.id);
    await repo.saveUser({
      id: data.user.id,
      role: existing?.role ?? "customer",
      email,
      fullName,
      phone,
      billingAddress,
      billingZip,
      passwordHash: null,
      workerId: existing?.workerId ?? null,
    });
    const user = await repo.getUser(data.user.id);
    const finished = user ? await finishDraft(repo, actorFromUser(user)) : null;
    redirect(finished ?? homeFor(user?.role ?? "customer"));
  }

  const taken = await repo.getUserByEmail(email);
  if (taken) redirect("/signup?error=" + encodeURIComponent("That email already has an account. Sign in instead."));
  const user = {
    id: randomUUID(),
    role: "customer" as const,
    email,
    fullName,
    phone,
    billingAddress,
    billingZip,
    passwordHash: hashPassword(password),
    workerId: null,
  };
  await repo.saveUser(user);
  await setLocalSession(user.id);
  const finished = await finishDraft(repo, actorFromUser(user));
  redirect(finished ?? "/jobs");
}

export async function signIn(form: FormData) {
  if (!(await allowRequest(ANON_LIMIT))) {
    redirect("/login?error=" + encodeURIComponent("Too many attempts from this network. Wait a few minutes and try again."));
  }
  const email = field(form, "email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const next = safeNext(field(form, "next"));
  const repo = getRepository();

  if (supabaseConfigured()) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) redirect("/login?error=" + encodeURIComponent("Email or password doesn't match."));
    const user = await repo.getUserByEmail(email);
    if (!user) redirect("/login?error=" + encodeURIComponent("You're signed in, but we don't have a profile for this email yet. Please contact us to sort it out."));
    const finished = await finishDraft(repo, actorFromUser(user));
    redirect(finished ?? next ?? homeFor(user.role));
  }

  const user = await repo.getUserByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    redirect("/login?error=" + encodeURIComponent("Email or password doesn't match."));
  }
  await setLocalSession(user.id);
  const finished = await finishDraft(repo, actorFromUser(user));
  redirect(finished ?? next ?? homeFor(user.role));
}

export async function demoSignIn(form: FormData) {
  if (!(await allowRequest(ANON_LIMIT))) {
    redirect("/login?error=" + encodeURIComponent("Too many attempts from this network. Wait a few minutes and try again."));
  }
  if (!demoSignInAllowed()) {
    redirect("/login?error=" + encodeURIComponent("Sample sign-in is turned off on this site."));
  }
  const role = field(form, "role");
  const id = role === "owner" ? DEMO_USERS.owner : role === "worker" ? DEMO_USERS.worker : DEMO_USERS.customer;
  const user = await getRepository().getUser(id);
  if (!user) redirect("/login?error=" + encodeURIComponent("Sample account is missing. Delete .data/db.json and reload."));
  await setLocalSession(user.id);
  redirect(homeFor(user.role));
}

export async function signOut() {
  if (supabaseConfigured()) {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }
  await clearLocalSession();
  redirect("/");
}

export async function updateAccount(form: FormData) {
  const actor = await requireActor();
  const repo = getRepository();
  const user = await repo.getUser(actor.id);
  if (!user) redirect("/login");
  const fullName = field(form, "fullName");
  const phone = field(form, "phone");
  const billingAddress = field(form, "billingAddress");
  const billingZip = field(form, "billingZip");
  const password = String(form.get("password") ?? "");
  if (!fullName || !phone || !billingAddress || !/^\d{5}$/.test(billingZip)) {
    redirect("/account?error=" + encodeURIComponent("Name, phone, billing address, and a 5-digit ZIP are required."));
  }
  if (password && password.length < 8) {
    redirect("/account?error=" + encodeURIComponent("Use a password of at least 8 characters, or leave it blank."));
  }
  await repo.saveUser({
    ...user,
    fullName,
    phone,
    billingAddress,
    billingZip,
    passwordHash: password && !supabaseConfigured() ? hashPassword(password) : user.passwordHash,
  });
  if (password && supabaseConfigured()) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) redirect("/account?error=" + encodeURIComponent(error.message));
  }
  redirect("/account?notice=" + encodeURIComponent("Account saved."));
}

const TOO_MANY = "Too many price checks from this network. Wait a few minutes and try again.";

/**
 * Price a listed service for a visitor with no account, and save them as a lead.
 * No AI call. The first check from a phone number sends Dale a notice.
 * Three guards against bots: a per-network limit on checks, a tighter limit on
 * new phone numbers, and a hidden field that only a script would fill in.
 */
export async function publicEstimateAction(
  input: unknown,
): Promise<{ ok: true; estimate: PublicEstimate; leadId: string } | { ok: false; error: string }> {
  if (!(await allowRequest(ANON_LIMIT))) return { ok: false, error: TOO_MANY };
  const trap = input && typeof input === "object" ? String((input as Record<string, unknown>).website_url_confirm ?? "") : "";
  if (trap.trim()) return { ok: false, error: TOO_MANY };
  const parsed = parseDraft(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const repo = getRepository();
  if (!(await recentLeadForPhone(repo, parsed.draft.phone)) && !(await allowRequest(LEAD_LIMIT))) {
    return { ok: false, error: TOO_MANY };
  }
  const result = await publicEstimate(repo, parsed.draft);
  if (!result.ok) return { ok: false, error: result.error };
  const lead = await recordLead(repo, parsed.draft, result.data);
  await settle(repo);
  return { ok: true, estimate: result.data, leadId: lead.id };
}

/** Keep the visitor's answers while they create an account or sign in. */
export async function startBookingAction(form: FormData) {
  const parsed = parseDraft(field(form, "draft"));
  if (!parsed.ok) redirect("/book?error=" + encodeURIComponent(parsed.error));
  await writeDraftCookie(parsed.draft);
  redirect(field(form, "next") === "login" ? "/login" : "/signup");
}

/** Drop the saved answers and start the public price page fresh. */
export async function discardDraftAction() {
  await clearDraftCookie();
  redirect("/book");
}

export async function submitQuote(input: {
  service: ServiceId;
  description: string;
  params: QuoteParams;
  differentSite: boolean;
  jobSiteAddress: string;
  urgent: boolean;
  pickup: boolean;
  preferredWorkerId: string | null;
  photos: { id: string; name: string }[];
}): Promise<{ error: string } | void> {
  if (!(await allowRequest(QUOTE_LIMIT))) {
    return { error: "Too many quotes from this network. Wait about an hour and try again." };
  }
  const actor = await requireActor();
  const repo = getRepository();
  const result = await createQuote(repo, actor, {
    ...input,
    params: { ...DEFAULT_PARAMS, ...input.params },
  });
  await settle(repo);
  if (!result.ok) return { error: result.error };
  redirect(`/jobs/${result.data.id}`);
}

export async function holdSlotAction(form: FormData) {
  const jobId = field(form, "jobId");
  const when = field(form, "when") === "earliest" ? "earliest" : { date: field(form, "date"), startMin: Number(form.get("startMin")) };
  await mutate(jobId, when === "earliest" ? "Your earliest time is held." : "That time is held.", (repo, actor) => holdSlot(repo, actor, jobId, when));
}

export async function releaseHoldAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "The hold is released. You can pick another time.", (repo, actor) => releaseHold(repo, actor, jobId));
}

export async function demoPayAction(form: FormData) {
  const jobId = field(form, "jobId");
  if (!demoSignInAllowed()) {
    jobBack(jobId, "error", DEMO_PAY_UNAVAILABLE);
  }
  await mutate(jobId, "Payment recorded. PayPal isn't connected here yet, so nothing was charged.", (repo, actor) => payJob(repo, actor, jobId, "paypal", `demo-${randomUUID()}`));
}

export async function manualPayAction(form: FormData) {
  const jobId = field(form, "jobId");
  const method = field(form, "method") === "check" ? "check" : "cash";
  await mutate(jobId, method === "check" ? "Marked paid by check." : "Marked paid by cash.", (repo, actor) => payJob(repo, actor, jobId, method, null));
}

export async function startPayPalAction(form: FormData) {
  const jobId = field(form, "jobId");
  const actor = await requireActor();
  const repo = getRepository();
  const job = await repo.getJob(jobId);
  if (!job) jobBack(jobId, "error", "Job not found.");
  if (actor.role === "customer" && job.customerId !== actor.id) jobBack(jobId, "error", "That job belongs to another customer.");
  const amount = amountPayable(job);
  if (amount <= 0) jobBack(jobId, "error", "Nothing is due on this job right now.");
  let approveUrl = "";
  try {
    const order = await createPayPalOrder({
      amount,
      invoiceNumber: job.invoiceNumber,
      jobId,
      returnUrl: `${appUrl()}/api/paypal/return?job=${jobId}`,
      cancelUrl: `${appUrl()}/jobs/${jobId}?notice=${encodeURIComponent("PayPal checkout was canceled. Nothing was charged.")}`,
    });
    job.paypalOrderId = order.id;
    await repo.saveJob(job, { skipOverlap: true });
    approveUrl = order.approveUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : "PayPal could not start checkout.";
    jobBack(jobId, "error", message);
  }
  redirect(approveUrl);
}

export async function cancelOnSiteAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Cancelled on site. Everything except travel will be refunded.", (repo, actor) => cancelOnSite(repo, actor, jobId));
}

export async function revisePriceAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "The customer was asked to approve the new price.", (repo, actor) =>
    proposePriceChange(repo, actor, jobId, String(form.get("total") ?? ""), field(form, "reason")),
  );
}

export async function decidePriceChangeAction(form: FormData) {
  const jobId = field(form, "jobId");
  const decision = field(form, "decision") === "decline" ? "decline" : "approve";
  await mutate(
    jobId,
    decision === "approve" ? "New price approved." : "Price change declined. Travel is kept and the rest is refunded.",
    (repo, actor) => decidePriceChange(repo, actor, jobId, decision),
  );
}

export async function startWorkAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Work started.", (repo, actor) => startWork(repo, actor, jobId));
}

export async function completeWorkAction(form: FormData) {
  const jobId = field(form, "jobId");
  const note = field(form, "note");
  await mutate(jobId, "Marked complete. The customer was asked to approve it.", (repo, actor) => completeWork(repo, actor, jobId, note));
}

export async function approveWorkAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Thanks. The work is approved.", (repo, actor) => approveWork(repo, actor, jobId));
}

export async function reportProblemAction(form: FormData) {
  const jobId = field(form, "jobId");
  const note = field(form, "note");
  if (note.length < 3) jobBack(jobId, "error", "Tell us what needs another look.");
  await mutate(jobId, "We have your note.", (repo, actor) => reportProblem(repo, actor, jobId, note));
}

export async function cancelAction(form: FormData) {
  const jobId = field(form, "jobId");
  const kind = field(form, "kind") === "reschedule" ? "reschedule" : "cancel";
  await mutate(
    jobId,
    kind === "reschedule" ? "Booking released. Pick a new time. The fee is already applied." : "Booking cancelled.",
    (repo, actor) => cancelBeforeWork(repo, actor, jobId, kind),
  );
}

export async function requestCancelAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "We have your cancellation request.", (repo, actor) => requestCancel(repo, actor, jobId));
}

export async function resolveCancelAction(form: FormData) {
  const jobId = field(form, "jobId");
  const decision = field(form, "decision") === "decline" ? "decline" : "approve";
  const refund = decision === "approve" ? String(form.get("refund") ?? "") : "0";
  await mutate(jobId, decision === "decline" ? "Cancellation declined. The job continues." : "Cancellation approved.", (repo, actor) =>
    resolveCancel(repo, actor, jobId, decision, refund),
  );
}

export async function markRefundAction(form: FormData) {
  const jobId = field(form, "jobId");
  const paymentId = field(form, "paymentId");
  await mutate(jobId, "Refund marked sent.", (repo, actor) => markRefundSent(repo, actor, paymentId));
}

export async function releaseLicenseAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Quote released to the customer.", (repo, actor) => releaseLicense(repo, actor, jobId));
}

export async function referOutAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Customer was referred out.", (repo, actor) => referOut(repo, actor, jobId, field(form, "note")));
}

export async function decideAreaAction(form: FormData) {
  const jobId = field(form, "jobId");
  const decision = field(form, "decision") === "decline" ? "decline" : "approve";
  await mutate(jobId, decision === "approve" ? "Address approved." : "Address declined.", (repo, actor) => decideArea(repo, actor, jobId, decision));
}

export async function reassignAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Crew updated.", (repo, actor) => reassignCrew(repo, actor, jobId, field(form, "crewId")));
}

export async function resumeProblemAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Problem cleared. The job is back where it was.", (repo, actor) => resumeAfterProblem(repo, actor, jobId));
}

export async function reviewAction(form: FormData) {
  const jobId = field(form, "jobId");
  const rating = Number(form.get("rating"));
  const comment = field(form, "comment");
  const publishPhotos = form.get("publishPhotos") === "on";
  await mutate(jobId, "Thanks for the review.", (repo, actor) => saveReview(repo, actor, jobId, rating, comment, publishPhotos));
}

export async function markNotesRead() {
  await requireRole("owner");
  await getRepository().markNotificationsRead();
  redirect("/owner/queue?notice=" + encodeURIComponent("Notices marked read."));
}

export async function saveSettingsAction(form: FormData) {
  await requireRole("owner");
  const repo = getRepository();
  const current = await repo.getSettings();
  const next: Settings = { ...current };
  for (const item of SETTING_FIELDS) {
    const raw = field(form, item.key);
    if (raw === "") continue;
    (next[item.key] as number) = Number(raw);
  }
  next.rrpCertified = form.get("rrpCertified") === "on";
  next.premiumEnabled = form.get("premiumEnabled") === "on";
  next.shopAddress = field(form, "shopAddress") || current.shopAddress;
  next.shopLat = Number(field(form, "shopLat"));
  next.shopLng = Number(field(form, "shopLng"));
  next.ownerNotifyEmail = field(form, "ownerNotifyEmail");
  next.businessName = field(form, "businessName") || current.businessName;
  next.businessPhone = field(form, "businessPhone");
  next.businessEmail = field(form, "businessEmail");
  next.licenseNumber = field(form, "licenseNumber");
  next.warrantyText = field(form, "warrantyText").slice(0, 2000);
  next.extraTerms = field(form, "extraTerms").slice(0, 6000);
  next.premiumCounties = field(form, "premiumCounties")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  next.builderThreshold = current.builderThreshold;
  await repo.saveSettings(normalizeSettings(next));
  redirect("/owner/settings?notice=" + encodeURIComponent("Rates and rules saved."));
}

function nullableField(form: FormData, key: string): number | null | undefined {
  if (!form.has(key)) return undefined;
  const raw = String(form.get(key) ?? "").trim();
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export async function saveLibraryAction(form: FormData) {
  await requireRole("owner");
  const repo = getRepository();
  const current = await repo.listLibrary();
  const groupAction = field(form, "groupAction");
  const [group, flag] = groupAction.split(":");
  const groupKey = group === "handy" || group === "trades" || group === "build" ? (group as LibraryGroup) : null;
  const next = current.map((entry) => {
    const performs =
      groupKey && entry.group === groupKey ? flag === "1" : form.get(`do_${entry.id}`) === "on";
    return {
      ...entry,
      name: field(form, `name_${entry.id}`) || entry.name,
      unit: field(form, `unit_${entry.id}`) || entry.unit,
      nationalLow: nullableField(form, `nl_${entry.id}`) === undefined ? entry.nationalLow : nullableField(form, `nl_${entry.id}`) ?? null,
      nationalHigh: nullableField(form, `nh_${entry.id}`) === undefined ? entry.nationalHigh : nullableField(form, `nh_${entry.id}`) ?? null,
      localLow: nullableField(form, `ll_${entry.id}`) === undefined ? entry.localLow : nullableField(form, `ll_${entry.id}`) ?? null,
      localHigh: nullableField(form, `lh_${entry.id}`) === undefined ? entry.localHigh : nullableField(form, `lh_${entry.id}`) ?? null,
      source: field(form, `src_${entry.id}`) || entry.source,
      notes: form.has(`notes_${entry.id}`) ? field(form, `notes_${entry.id}`) : entry.notes,
      performs,
    };
  });
  await repo.saveLibrary(mergeLibrary(next));
  redirect("/owner/library?notice=" + encodeURIComponent(groupKey ? "Group updated and library saved." : "Cost library saved."));
}

export async function saveCrewAction(form: FormData) {
  await requireRole("owner");
  const repo = getRepository();
  const id = field(form, "id") || randomUUID();
  const crew: CrewRecord = { id, name: field(form, "name") || "Crew", active: form.get("active") === "on" };
  await repo.saveCrew(crew);
  redirect("/owner/settings?notice=" + encodeURIComponent("Crew saved."));
}

export async function deleteCrewAction(form: FormData) {
  await requireRole("owner");
  const repo = getRepository();
  const id = field(form, "id");
  const jobs = await repo.listJobs();
  if (jobs.some((job) => job.crewId === id && blocksSchedule(job.status))) {
    redirect("/owner/settings?error=" + encodeURIComponent("That crew still has a job on the schedule."));
  }
  await repo.deleteCrew(id);
  redirect("/owner/settings?notice=" + encodeURIComponent("Crew removed."));
}

export async function saveWorkerAction(form: FormData) {
  await requireRole("owner");
  const repo = getRepository();
  const id = field(form, "id") || randomUUID();
  const days = form.getAll("workDays").map((value) => Number(value)).filter((value) => value >= 0 && value <= 6);
  const email = field(form, "email").toLowerCase();
  const fullName = field(form, "fullName");
  if (!fullName || !email) redirect("/owner/settings?error=" + encodeURIComponent("A worker needs a name and email."));
  const existing = (await repo.listWorkers()).find((worker) => worker.id === id);
  const worker: WorkerRecord = {
    id,
    profileId: existing?.profileId ?? null,
    fullName,
    email,
    crewId: field(form, "crewId") || null,
    dayStartMin: Number(field(form, "dayStartMin") || "480"),
    dayEndMin: Number(field(form, "dayEndMin") || "1020"),
    workDays: days.length ? days : [1, 2, 3, 4, 5, 6],
    active: form.get("active") === "on",
  };
  await repo.saveWorker(worker);
  const password = String(form.get("password") ?? "");
  if (password) {
    if (password.length < 8) redirect("/owner/settings?error=" + encodeURIComponent("Worker password must be at least 8 characters."));
    await ensureWorkerLogin(repo, worker, password);
  }
  redirect("/owner/settings?notice=" + encodeURIComponent("Worker saved."));
}

async function ensureWorkerLogin(repo: Repository, worker: WorkerRecord, password: string) {
  if (supabaseConfigured()) {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const existing = await repo.getUserByEmail(worker.email);
    if (existing) {
      if (existing.role === "owner") return;
      await admin.auth.admin.updateUserById(existing.id, { password });
      await repo.saveUser({ ...existing, role: "worker", fullName: worker.fullName, workerId: worker.id, passwordHash: null });
      return;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: worker.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: worker.fullName },
    });
    if (error || !data.user) throw new Error(error?.message || "Could not create the worker login.");
    const profile = await repo.getUser(data.user.id);
    await repo.saveUser({
      id: data.user.id,
      role: "worker",
      email: worker.email,
      fullName: worker.fullName,
      phone: profile?.phone ?? "",
      billingAddress: profile?.billingAddress ?? "",
      billingZip: profile?.billingZip ?? "",
      passwordHash: null,
      workerId: worker.id,
    });
    return;
  }
  const existing = await repo.getUserByEmail(worker.email);
  if (existing?.role === "owner") return;
  const user = {
    id: existing?.id ?? randomUUID(),
    role: "worker" as Role,
    email: worker.email,
    fullName: worker.fullName,
    phone: existing?.phone ?? "",
    billingAddress: existing?.billingAddress ?? "",
    billingZip: existing?.billingZip ?? "",
    passwordHash: hashPassword(password),
    workerId: worker.id,
  };
  await repo.saveUser(user);
}

export async function deleteWorkerAction(form: FormData) {
  await requireRole("owner");
  const repo = getRepository();
  const id = field(form, "id");
  const jobs = await repo.listJobs();
  if (jobs.some((job) => job.workerIds.includes(id) && blocksSchedule(job.status))) {
    redirect("/owner/settings?error=" + encodeURIComponent("That worker is still on a scheduled job."));
  }
  await repo.deleteWorker(id);
  redirect("/owner/settings?notice=" + encodeURIComponent("Worker removed."));
}

export async function addTimeOffAction(form: FormData) {
  await requireRole("owner");
  const workerId = field(form, "workerId");
  const date = field(form, "date");
  if (!workerId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    redirect("/owner/settings?error=" + encodeURIComponent("Pick a worker and a day off."));
  }
  await getRepository().addTimeOff(workerId, date);
  redirect("/owner/settings?notice=" + encodeURIComponent("Day off added."));
}

export async function removeTimeOffAction(form: FormData) {
  await requireRole("owner");
  await getRepository().removeTimeOff(field(form, "id"));
  redirect("/owner/settings?notice=" + encodeURIComponent("Day off removed."));
}

// ---------------------------------------------------------------------------
// Owner-entered jobs (phone and in-person) and the contract and invoice page
// ---------------------------------------------------------------------------

function newJobBack(message: string): never {
  redirect("/owner/jobs/new?error=" + encodeURIComponent(message));
}

/** The owner types a phone or in-person job once: customer, work, firm price, and (optionally) the time. */
export async function createOwnerJobAction(form: FormData) {
  const actor = await requireRole("owner");
  const repo = getRepository();
  const total = Number(field(form, "total").replace(/[$,]/g, ""));
  if (!Number.isFinite(total) || total <= 0) newJobBack("Enter the price as a dollar amount.");
  const travel = Number(field(form, "travel").replace(/[$,]/g, "") || "0");
  if (!Number.isFinite(travel) || travel < 0) newJobBack("Travel has to be a dollar amount, or blank.");
  const service = field(form, "service") as ServiceId;
  if (!(service in SERVICE_LABELS)) newJobBack("Pick a service.");
  const billingZip = field(form, "billingZip");
  if (!/^\d{5}$/.test(billingZip)) newJobBack("The billing ZIP must be 5 digits.");
  const password = String(form.get("password") ?? "");
  if (password && password.length < 8) newJobBack("A temporary password needs at least 8 characters.");
  // Cheap checks first, so a typo doesn't leave behind a customer account with no job.
  if (field(form, "scope").length < 3) newJobBack("Give the job a short title, such as 'Replace bathroom faucet'.");
  if (travel > total) newJobBack("Travel can't be more than the whole price.");
  const hours = Number(field(form, "hours") || "2");
  if (!Number.isFinite(hours) || hours < OWNER_JOB_LIMITS.minHours || hours > OWNER_JOB_LIMITS.maxHours) {
    newJobBack(`Hours on site must be between ${OWNER_JOB_LIMITS.minHours} and ${OWNER_JOB_LIMITS.maxHours}.`);
  }
  const days = Number(field(form, "days") || "1");
  if (!Number.isFinite(days) || days < 1 || days > OWNER_JOB_LIMITS.maxDays) newJobBack(`Days must be between 1 and ${OWNER_JOB_LIMITS.maxDays}.`);
  const siteText = field(form, "jobSiteAddress") || billingZip;
  if (!areaCheck(siteText, await repo.listZips()).found) newJobBack("Add a 5-digit ZIP to the job site address.");

  const account = await ensureCustomerAccount(repo, {
    fullName: field(form, "fullName"),
    email: field(form, "email"),
    phone: field(form, "phone"),
    billingAddress: field(form, "billingAddress"),
    billingZip,
    password,
  });
  if (!account.ok) newJobBack(account.error);

  const created = await createOwnerJob(repo, actor, {
    customer: account.user,
    service,
    scope: field(form, "scope"),
    description: field(form, "description"),
    jobSiteAddress: field(form, "jobSiteAddress"),
    hoursOnSite: hours,
    days,
    crewSize: Number(field(form, "crewSize") || "1"),
    total,
    travel,
  });
  if (!created.ok) newJobBack(created.error);
  const job = created.data;

  const notes = [`Job added${job.invoiceNumber ? `, invoice #${job.invoiceNumber}` : ""}.`];
  if (account.created) {
    notes.push(
      password
        ? `Customer account created for ${account.user.email} with the temporary password you set.`
        : `Customer account created for ${account.user.email}. No password was set; the contract link works without one.`,
    );
  }
  const date = field(form, "date");
  const startMin = Number(field(form, "startMin"));
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(startMin)) {
      notes.push("The date or time didn't read right, so nothing is held yet. Pick a time on the job page.");
    } else {
      const holdHours = Number(field(form, "holdHours") || "0") || undefined;
      const held = await holdSlot(repo, actor, job.id, { date, startMin }, { holdHours });
      if (held.ok) {
        const until = held.data.holdUntil
          ? new Date(held.data.holdUntil).toLocaleString("en-US", { timeZone: "America/Detroit", dateStyle: "medium", timeStyle: "short" })
          : "";
        notes.push(`${formatDateRange(jobDates(held.data))} at ${formatMinutes(startMin)} is held${until ? ` until ${until}` : ""}; the customer was emailed.`);
      } else {
        notes.push(`Couldn't hold ${formatDate(date)} at ${formatMinutes(startMin)}: ${held.error} Pick a time on the job page.`);
      }
    }
  }
  const settings = await repo.getSettings();
  if (!settings.licenseNumber && job.total >= settings.builderThreshold) {
    notes.push(`Heads up: this is $${Math.round(settings.builderThreshold)} or more and no license number is saved under Rates, so the agreement says a licensed contractor does the licensed part.`);
  }
  await settle(repo);
  redirect(`/jobs/${job.id}/contract?notice=${encodeURIComponent(notes.join(" "))}`);
}

/** The customer types their name to accept the agreement. Works signed in or from the emailed link. */
export async function signAgreementAction(form: FormData) {
  const jobId = field(form, "jobId");
  const token = field(form, "token") || null;
  const back = (kind: "notice" | "error", message: string): never => {
    const target = token ? `/contract/${jobId}?k=${encodeURIComponent(token)}` : `/jobs/${jobId}/contract`;
    redirect(`${target}${token ? "&" : "?"}${kind}=${encodeURIComponent(message)}`);
  };
  if (!jobId) redirect("/");
  if (!(await allowRequest(ANON_LIMIT))) back("error", "Too many attempts from this network. Wait a few minutes and try again.");
  if (form.get("agree") !== "on") back("error", "Tick the box to confirm you've read the agreement.");
  const actor = await currentActor();
  const headerList = await headers();
  const repo = getRepository();
  const result = await signAgreement(repo, {
    jobId,
    actor,
    token,
    signedName: field(form, "signedName"),
    ip: clientIp(headerList),
    userAgent: headerList.get("user-agent") ?? "",
  });
  await settle(repo);
  if (!result.ok) back("error", result.error);
  back("notice", "Thanks, your signature is recorded. Print or save this page for your records.");
}

/** Owner: email the customer the link to their contract and invoice. */
export async function sendAgreementAction(form: FormData) {
  const actor = await requireRole("owner");
  const jobId = field(form, "jobId");
  const repo = getRepository();
  const result = await sendAgreement(repo, actor, jobId);
  await settle(repo);
  if (!result.ok) redirect(`/jobs/${jobId}/contract?error=${encodeURIComponent(result.error)}`);
  const note = resendConfigured()
    ? `Emailed to ${result.data.customerEmail}.`
    : `Queued for ${result.data.customerEmail}. Email isn't connected yet, so it sits in the Queue until Resend is set up; you can share the link below instead.`;
  redirect(`/jobs/${jobId}/contract?notice=${encodeURIComponent(note)}`);
}

// ---------------------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------------------

const RESET_SENT = "If that email has an account, a reset link is on its way. Check spam if it doesn't show up in a few minutes.";

/** Ask for a reset link. The answer never says whether the email exists. */
export async function requestPasswordResetAction(form: FormData) {
  if (!(await allowRequest(ANON_LIMIT))) {
    redirect("/forgot?error=" + encodeURIComponent("Too many attempts from this network. Wait a few minutes and try again."));
  }
  const email = field(form, "email").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect("/forgot?error=" + encodeURIComponent("Enter the email you signed up with."));
  const repo = getRepository();
  if (supabaseConfigured()) {
    const supabase = await createSupabaseServer();
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${appUrl()}/auth/confirm?next=/reset` });
    if (error) {
      console.error("[auth] reset email failed", error.message);
      const text = error.message.toLowerCase();
      if (text.includes("not authorized") || text.includes("rate limit") || text.includes("smtp")) {
        redirect(
          "/forgot?error=" +
            encodeURIComponent("We couldn't send a reset email to that address yet. Please call or email us and we'll reset it for you."),
        );
      }
    }
    redirect("/forgot?notice=" + encodeURIComponent(RESET_SENT));
  }
  // Saved-file demo: the link prints in the terminal with the other emails.
  const user = await repo.getUserByEmail(email);
  if (user) {
    const token = issueLocalResetToken(user.id);
    await repo.addEmail({
      id: randomUUID(),
      to: user.email,
      subject: "Reset your eX Construction password",
      body: `Hi ${user.fullName}, open this link to choose a new password. It works once, for an hour.\n\n${appUrl()}/reset?t=${token}`,
      jobId: null,
      sent: false,
      createdAt: new Date().toISOString(),
    });
    await settle(repo);
  }
  redirect("/forgot?notice=" + encodeURIComponent(RESET_SENT));
}

/** Save the new password. On the live site this needs the recovery session the emailed link created. */
export async function setNewPasswordAction(form: FormData) {
  const password = String(form.get("password") ?? "");
  const again = String(form.get("passwordAgain") ?? "");
  const token = field(form, "token");
  const back = (message: string): never => redirect(`/reset?${token ? `t=${encodeURIComponent(token)}&` : ""}error=${encodeURIComponent(message)}`);
  if (password.length < 8) back("Use a password of at least 8 characters.");
  if (password !== again) back("The two passwords don't match.");
  const repo = getRepository();
  if (supabaseConfigured()) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.getUser();
    if (!data.user) redirect("/forgot?error=" + encodeURIComponent("That reset link has expired or was already used. Ask for a new one."));
    const { error } = await supabase.auth.updateUser({ password });
    if (error) back(error.message);
    const user = await repo.getUser(data.user.id);
    redirect(`${homeFor(user?.role ?? "customer")}?notice=${encodeURIComponent("Your password is saved and you're signed in.")}`);
  }
  const userId = consumeLocalResetToken(token);
  if (!userId) redirect("/forgot?error=" + encodeURIComponent("That reset link has expired or was already used. Ask for a new one."));
  const user = await repo.getUser(userId);
  if (!user) redirect("/forgot?error=" + encodeURIComponent("Account not found."));
  await repo.saveUser({ ...user, passwordHash: hashPassword(password) });
  await setLocalSession(user.id);
  redirect(`${homeFor(user.role)}?notice=${encodeURIComponent("Your password is saved and you're signed in.")}`);
}
