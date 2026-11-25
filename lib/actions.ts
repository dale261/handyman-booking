"use server";

import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ensureCustomerAccount, updateCustomerContact } from "@/lib/accounts";
import { clearLocalSession, createSupabaseServer, currentActor, homeFor, requireActor, requireRole, safeNext, setLocalSession } from "@/lib/auth";
import { clientIp } from "@/lib/client-ip";
import { jobForLink, sendAgreement, setNotBuilderWork, setWhiteLabel, signAgreement } from "@/lib/services/agreement";
import { addHours, removeHours } from "@/lib/services/hours";
import { addExpense, addShopHours, removeCrewEntry, setReimbursed } from "@/lib/services/crew-log";
import { addFlatPay, addPayment, addPayPerson, dropRatesFor, payBlocksRemoval, removePayItem, saveListRate, saveShopDefault, setRate } from "@/lib/services/pay";
import { RATE_SHOP, RATE_USUAL, readMethod } from "@/lib/domain/pay";
import { checkPayFile, clearLoadedPay, loadPayFile, type LoadResult } from "@/lib/services/pay-load";
import { LOAD_LIMITS, type LoadChoices, type LoadSummary } from "@/lib/domain/pay-load";
import { joinCrew } from "@/lib/services/crew-join";
import { INVITE_DAYS, INVITE_EMAIL_SUBJECT, inviteEmailBody, inviteLink, parseInviteContact, readInvite, signInvite, type CrewInvite } from "@/lib/invites";
import { isDate } from "@/lib/domain/hours";
import { builderRuleApplies } from "@/lib/domain/agreement";
import { checkDoneOn, createOwnerJob, OWNER_JOB_LIMITS } from "@/lib/services/owner-jobs";
import { clearDiscount, editOwnerJob, setDiscount, voidInvoice } from "@/lib/services/adjust";
import { areaCheck } from "@/lib/domain/area";
import { phoneDigits, realEmail } from "@/lib/domain/contact";
import { DEMO_PAY_UNAVAILABLE, demoSignInAllowed } from "@/lib/demo";
import { getRepository, supabaseConfigured } from "@/lib/db/index";
import { allowRequest, ANON_LIMIT, LEAD_LIMIT, PASTE_LIMIT, QUOTE_LIMIT } from "@/lib/rate-limit";
import { fillFromModel, fillFromRules, PASTE_MAX_CHARS, type PasteRead } from "@/lib/domain/paste-fill";
import { pasteModelConfigured, readPasteWithModel } from "@/lib/paste-ai";
import { DEMO_USERS } from "@/lib/db/local";
import type { Repository } from "@/lib/db/repository";
import { actorFromUser, type Actor, type CrewRecord, type Role, type UserRecord, type WorkerRecord } from "@/lib/db/types";
import { clearDraftCookie, writeDraftCookie } from "@/lib/draft-cookie";
import { finishDraft } from "@/lib/draft-finish";
import { jobSiteAddress, parseDraft } from "@/lib/domain/draft";
import { mergeLibrary } from "@/lib/domain/library";
import type { LibraryGroup } from "@/lib/domain/library-data";
import { normalizeSettings, SETTING_FIELDS } from "@/lib/domain/settings";
import type { QuoteParams, ServiceId, Settings } from "@/lib/domain/types";
import { DEFAULT_PARAMS, SERVICE_LABELS } from "@/lib/domain/types";
import { flushEmails, resendConfigured, sendEmailNow } from "@/lib/email";
import { hashPassword, verifyPassword } from "@/lib/password";
import { consumeLocalResetToken, issueLocalResetToken } from "@/lib/password-reset";
import { resetOrigin, sendResetEmail } from "@/lib/reset-email";
import { createPayPalOrder, paypalConfigured } from "@/lib/paypal";
import { appUrl, formatDate, formatDateRange, formatMinutes, todayDetroit } from "@/lib/format";
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
  recordSignOff,
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
  // Only the owner's hold length is honored (holdSlot ignores it for anyone else).
  const holdHours = Number(field(form, "holdHours") || "0") || undefined;
  const actor = await requireActor();
  const repo = getRepository();
  const result = await holdSlot(repo, actor, jobId, when, { holdHours });
  await settle(repo);
  if (!result.ok) jobBack(jobId, "error", result.error);
  const data = result.data;
  const label = `${formatDateRange(jobDates(data))} at ${formatMinutes(data.startMin ?? 0)}`;
  let notice =
    data.status === "booked"
      ? `${label} is booked. It was already paid, so nothing more is due now.`
      : data.status === "held"
        ? `${label} is held.`
        : `${label} is requested. It's held once the address is approved.`;
  if (actor.role === "owner" && data.status === "held") {
    notice += paypalConfigured() ? " The customer was emailed the link to pay." : " The customer was emailed; we'll contact them to take the payment.";
  } else if (actor.role === "owner" && data.status === "booked") {
    notice += " The customer was emailed the confirmation.";
  }
  jobBack(jobId, "notice", notice);
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
  await mutate(jobId, "Marked complete. The customer was told, and any balance is now due.", (repo, actor) => completeWork(repo, actor, jobId, note));
}

/** A crew member logs hours on a job, or the owner logs them for someone. */
export async function addHoursAction(form: FormData) {
  const jobId = field(form, "jobId");
  const hours = Number(field(form, "hours"));
  await mutate(jobId, "Hours added.", (repo, actor) =>
    addHours(repo, actor, jobId, { workerId: field(form, "workerId") || undefined, date: field(form, "date"), hours, note: field(form, "note") }),
  );
}

export async function removeHoursAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Hours removed.", (repo, actor) => removeHours(repo, actor, jobId, field(form, "entryId")));
}

/** Pages the crew-log forms may send people back to. Anything else falls back by role. */
const CREW_LOG_PAGES = ["/worker", "/owner/hours", "/owner/receipts"];

/** Shop time and receipts aren't on a job page, so they go back to the page the form was on. */
async function crewLog(form: FormData, notice: string, work: (repo: Repository, actor: Actor) => Promise<{ ok: true } | { ok: false; error: string }>) {
  const actor = await requireActor();
  const asked = field(form, "back");
  const fallback = actor.role === "owner" ? "/owner/hours" : "/worker";
  const page = CREW_LOG_PAGES.includes(asked) && (actor.role === "owner" || asked === "/worker") ? asked : fallback;
  const week = field(form, "week");
  const extra = page === "/owner/hours" && isDate(week) ? `&week=${week}` : "";
  const repo = getRepository();
  const result = await work(repo, actor);
  await settle(repo);
  if (!result.ok) redirect(`${page}?error=${encodeURIComponent(result.error)}${extra}`);
  redirect(`${page}?notice=${encodeURIComponent(notice)}${extra}`);
}

/** Hours that weren't on a job: loading up, cleaning tools, a supply run. */
export async function addShopHoursAction(form: FormData) {
  const hours = Number(field(form, "hours"));
  await crewLog(form, "Shop time added.", (repo, actor) =>
    addShopHours(repo, actor, { workerId: field(form, "workerId") || undefined, date: field(form, "date"), hours, note: field(form, "note") }),
  );
}

/** A receipt for something a crew member paid for and should be paid back. */
export async function addExpenseAction(form: FormData) {
  const amount = Number(field(form, "amount").replace(/[$,\s]/g, ""));
  await crewLog(form, "Receipt saved.", (repo, actor) =>
    addExpense(repo, actor, {
      workerId: field(form, "workerId") || undefined,
      date: field(form, "date"),
      amount,
      what: field(form, "what"),
      jobId: field(form, "jobId") || undefined,
      photoId: field(form, "photoId") || undefined,
    }),
  );
}

/**
 * Hours on a job, added from the crew page: the crew member picks the job from a list, so
 * it can be one their crew isn't scheduled on. They come back to the crew page afterwards.
 */
export async function addJobHoursAction(form: FormData) {
  const jobId = field(form, "jobId");
  const hours = Number(field(form, "hours"));
  await crewLog(form, "Hours added.", async (repo, actor) =>
    jobId
      ? addHours(repo, actor, jobId, { workerId: field(form, "workerId") || undefined, date: field(form, "date"), hours, note: field(form, "note") })
      : { ok: false as const, error: "Pick the job you worked on." },
  );
}

export async function removeJobHoursAction(form: FormData) {
  await crewLog(form, "Hours removed.", (repo, actor) => removeHours(repo, actor, field(form, "jobId"), field(form, "entryId")));
}

export async function removeCrewEntryAction(form: FormData) {
  await crewLog(form, "Removed.", (repo, actor) => removeCrewEntry(repo, actor, field(form, "entryId")));
}

/** Owner: mark a receipt paid back, or undo it. */
export async function reimburseAction(form: FormData) {
  const done = field(form, "done") === "1";
  await crewLog(form, done ? "Marked paid back." : "Marked not paid back yet.", (repo, actor) => setReimbursed(repo, actor, field(form, "entryId"), done));
}

/** A dollar amount typed into a form: "$1,250.50" reads as 1250.5. */
function money(form: FormData, key: string): number {
  const raw = field(form, key).replace(/[$,\s]/g, "");
  return raw ? Number(raw) : Number.NaN;
}

/**
 * Crew pay forms live on the owner's Pay page and go back to it, on the same person's
 * record when one is open. Each service checks again that it is the owner.
 */
async function payForm(
  form: FormData,
  notice: string,
  work: (repo: Repository, actor: Actor) => Promise<{ ok: true; notice?: string } | { ok: false; error: string }>,
  page = "/owner/pay",
) {
  const actor = await requireRole("owner");
  const who = field(form, "who");
  const extra = /^[\w-]{1,64}$/.test(who) ? `&who=${who}` : "";
  const repo = getRepository();
  const result = await work(repo, actor);
  await settle(repo);
  if (!result.ok) redirect(`${page}?error=${encodeURIComponent(result.error)}${extra}`);
  redirect(`${page}?notice=${encodeURIComponent(result.notice ?? notice)}${extra}`);
}

/**
 * Put a rate on hours someone logged, or change it. With "remember" ticked, the rate also
 * goes on the rate list for that person on that job, so their next hours there get it.
 */
export async function setRateAction(form: FormData) {
  const remember = field(form, "remember") === "on";
  await payForm(form, "Rate set.", async (repo, actor) => {
    const result = await setRate(repo, actor, field(form, "entryId"), money(form, "rate"), remember);
    if (!result.ok || !remember) return result;
    return { ok: true, notice: result.remembered ? "Rate set, and saved to your rate list." : "Rate set. It couldn't be saved to the rate list." };
  });
}

/** A rate box on the rate list: a number saves it, blank takes it off. */
function listRate(form: FormData, key: string): number | null {
  return field(form, key) === "" ? null : money(form, key);
}

/** One person's usual rate and shop time rate, from the rate list page. */
export async function saveRatesAction(form: FormData) {
  const workerId = field(form, "workerId");
  await payForm(
    form,
    "Rates saved.",
    async (repo, actor) => {
      const usual = await saveListRate(repo, actor, { workerId, scope: RATE_USUAL, rate: listRate(form, "usual") });
      if (!usual.ok) return usual;
      return saveListRate(repo, actor, { workerId, scope: RATE_SHOP, rate: listRate(form, "shop") });
    },
    "/owner/pay/rates",
  );
}

/** The shop time rate for everyone who has none of their own. Blank takes it off. */
export async function saveShopDefaultAction(form: FormData) {
  const rate = listRate(form, "rate");
  await payForm(form, rate === null ? "Shop time has no rate for everyone now." : "Saved. Shop time pays that unless someone has their own rate.", (repo, actor) => saveShopDefault(repo, actor, rate), "/owner/pay/rates");
}

/** A rate for one person on one job. */
export async function saveJobRateAction(form: FormData) {
  await payForm(
    form,
    "Job rate saved.",
    async (repo, actor) => {
      const jobId = field(form, "jobId");
      if (!jobId) return { ok: false as const, error: "Pick the job the rate is for." };
      if (field(form, "rate") === "") return { ok: false as const, error: "Enter the rate in dollars an hour." };
      return saveListRate(repo, actor, { workerId: field(form, "workerId"), scope: jobId, rate: money(form, "rate") });
    },
    "/owner/pay/rates",
  );
}

export async function removeJobRateAction(form: FormData) {
  await payForm(form, "Job rate removed.", (repo, actor) => saveListRate(repo, actor, { workerId: field(form, "workerId"), scope: field(form, "jobId"), rate: null }), "/owner/pay/rates");
}

/** Pay that isn't by the hour: a flat amount for a job, a split, a bonus. */
export async function addFlatPayAction(form: FormData) {
  await payForm(form, "Pay added.", (repo, actor) =>
    addFlatPay(repo, actor, { workerId: field(form, "workerId"), date: field(form, "date"), amount: money(form, "amount"), what: field(form, "what"), jobId: field(form, "jobId") || undefined }),
  );
}

/** Record money paid to a crew member. */
export async function addPaymentAction(form: FormData) {
  await payForm(form, "Payment recorded.", (repo, actor) =>
    addPayment(repo, actor, { workerId: field(form, "workerId"), date: field(form, "date"), amount: money(form, "amount"), note: field(form, "note"), method: readMethod(field(form, "method")) }),
  );
}

export async function removePayItemAction(form: FormData) {
  await payForm(form, "Removed.", (repo, actor) => removePayItem(repo, actor, field(form, "itemId")));
}

/** Someone to pay who isn't on the crew list: a helper for a day, or a past worker. */
export async function addPayPersonAction(form: FormData) {
  await payForm(form, "Added. You can pick them in the forms below.", (repo, actor) => addPayPerson(repo, actor, field(form, "fullName")));
}

/** What the load screen sends: the file's text and who each name in it is. Trimmed to plain, bounded values. */
function loadInput(text: string, choices: LoadChoices): { text: string; choices: LoadChoices } {
  const picked: LoadChoices = {};
  if (choices && typeof choices === "object") {
    for (const [name, value] of Object.entries(choices).slice(0, 200)) {
      if (typeof value === "string" && name.length <= 80 && value.length <= 64) picked[name] = value;
    }
  }
  return { text: String(text ?? "").slice(0, LOAD_LIMITS.chars + 1), choices: picked };
}

/** Loading the owner's pay records: read the file and say what would happen. Saves nothing. */
export async function checkPayFileAction(text: string, choices: LoadChoices): Promise<{ ok: true; data: LoadSummary } | { ok: false; error: string }> {
  const actor = await requireRole("owner");
  const input = loadInput(text, choices);
  return checkPayFile(getRepository(), actor, input.text, input.choices);
}

/** Load the file the owner just checked. */
export async function loadPayFileAction(text: string, choices: LoadChoices): Promise<{ ok: true; data: LoadResult } | { ok: false; error: string }> {
  const actor = await requireRole("owner");
  const input = loadInput(text, choices);
  return loadPayFile(getRepository(), actor, input.text, input.choices);
}

/** Take off everything that came from a records file. */
export async function clearLoadedPayAction() {
  const actor = await requireRole("owner");
  const result = await clearLoadedPay(getRepository(), actor);
  if (!result.ok) redirect(`/owner/pay/load?error=${encodeURIComponent(result.error)}`);
  redirect(`/owner/pay/load?notice=${encodeURIComponent(result.data === 0 ? "Nothing had been loaded." : `Removed ${result.data} loaded ${result.data === 1 ? "line" : "lines"}.`)}`);
}

/** The crew's phone, handed to whoever is on site: record their sign-off. */
export async function signOffAction(form: FormData) {
  const jobId = field(form, "jobId");
  if (!jobId) redirect("/");
  const back = (query: string): never => redirect(`/jobs/${jobId}/signoff?${query}`);
  if (form.get("agree") !== "on") back(`error=${encodeURIComponent("Tick the box to confirm the work was completed properly.")}`);
  const actor = await requireActor();
  const repo = getRepository();
  const result = await recordSignOff(repo, actor, jobId, { name: field(form, "name"), title: field(form, "title"), note: field(form, "note") });
  await settle(repo);
  if (!result.ok) back(`error=${encodeURIComponent(result.error)}`);
  back("done=1");
}

export async function approveWorkAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Thanks for confirming the work looks right.", (repo, actor) => approveWork(repo, actor, jobId));
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

/**
 * The owner types a phone number or an email and the person sets up their own sign-in.
 * An email invite is sent from here. A phone invite comes back as a link with a
 * "Text it" button, because the site doesn't send texts: the owner's own phone does.
 * Nothing is saved until the person joins.
 */
export async function inviteWorkerAction(form: FormData) {
  await requireRole("owner");
  const stop = (message: string): never => redirect("/owner/settings?error=" + encodeURIComponent(message));
  const contact = parseInviteContact(field(form, "contact"));
  if (!contact.ok) return stop(contact.error);
  const repo = getRepository();
  const crewId = field(form, "crewId");
  const crew = crewId ? (await repo.listCrews()).find((item) => item.id === crewId && item.active) : undefined;
  if (crewId && !crew) stop("Pick a crew from the list.");
  if (contact.email && (await repo.listWorkers()).some((worker) => worker.email.toLowerCase() === contact.email)) {
    stop("That email is already on your crew list.");
  }
  const invite: CrewInvite = {
    id: randomUUID(),
    crewId: crew?.id ?? null,
    email: contact.email,
    phone: contact.phone,
    expires: Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000,
  };
  const token = signInvite(invite);
  let sent = "";
  if (contact.email) {
    const ok = await sendEmailNow({ to: contact.email, subject: INVITE_EMAIL_SUBJECT, body: inviteEmailBody(inviteLink(token, resetOrigin())) });
    sent = ok ? "&sent=1" : "&sent=0";
  }
  redirect(`/owner/settings?invite=${encodeURIComponent(token)}${sent}`);
}

/** The sign-in for someone joining from an invite. Never used for an email that already has an account. */
async function makeCrewLogin(repo: Repository, worker: WorkerRecord, password: string, phone: string): Promise<UserRecord> {
  const base = { role: "worker" as Role, email: worker.email, fullName: worker.fullName, phone, billingAddress: "", billingZip: "", workerId: worker.id };
  if (supabaseConfigured()) {
    const { createClient } = await import("@supabase/supabase-js");
    const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await admin.auth.admin.createUser({
      email: worker.email,
      password,
      email_confirm: true,
      user_metadata: { full_name: worker.fullName, phone },
    });
    if (error || !data.user) throw new Error(error?.message || "Could not create the crew login.");
    const user: UserRecord = { ...base, id: data.user.id, passwordHash: null };
    try {
      await repo.saveUser(user);
    } catch (problem) {
      // Don't leave a login behind that isn't tied to a crew member.
      await admin.auth.admin.deleteUser(data.user.id).catch(() => undefined);
      throw problem;
    }
    return user;
  }
  const user: UserRecord = { ...base, id: randomUUID(), passwordHash: hashPassword(password) };
  await repo.saveUser(user);
  return user;
}

/** Someone opened their invite link and filled in their own name, email and password. */
export async function joinCrewAction(form: FormData) {
  const token = field(form, "k");
  const back = (message: string): never => redirect(`/join?k=${encodeURIComponent(token)}&error=${encodeURIComponent(message)}`);
  if (!(await allowRequest(ANON_LIMIT))) back("Too many attempts from this network. Wait a few minutes and try again.");
  const invite = readInvite(token);
  // The page explains an expired or incomplete link.
  if (!invite) return redirect("/join");
  const actor = await currentActor();
  const repo = getRepository();
  const password = String(form.get("password") ?? "");
  const result = await joinCrew(
    repo,
    invite,
    { fullName: field(form, "fullName"), email: field(form, "email"), password },
    actor,
    (worker, chosen, phone) => makeCrewLogin(repo, worker, chosen, phone),
  );
  await settle(repo);
  if (!result.ok) return back(result.error);
  if (result.newLogin) {
    if (supabaseConfigured()) {
      const supabase = await createSupabaseServer();
      const { error } = await supabase.auth.signInWithPassword({ email: result.user.email, password });
      if (error) redirect("/login?notice=" + encodeURIComponent("Your sign-in is set up. Sign in with the email and password you just chose."));
    } else {
      await setLocalSession(result.user.id);
    }
  }
  redirect("/worker?notice=" + encodeURIComponent("You're on the crew. This is your page: your jobs, your hours, shop time and receipts."));
}

export async function deleteWorkerAction(form: FormData) {
  await requireRole("owner");
  const repo = getRepository();
  const id = field(form, "id");
  const jobs = await repo.listJobs();
  if (jobs.some((job) => job.workerIds.includes(id) && blocksSchedule(job.status))) {
    redirect("/owner/settings?error=" + encodeURIComponent("That worker is still on a scheduled job."));
  }
  // Someone with pay on record stays on the list, or their record would have no person to pay.
  const held = await payBlocksRemoval(repo, id);
  if (held) redirect("/owner/settings?error=" + encodeURIComponent(held));
  await repo.deleteWorker(id);
  await dropRatesFor(repo, id);
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

/**
 * The paste box on Add a job: read the owner's note (a customer's message, or his own
 * words) into form values. Saves nothing and never sets a price the note doesn't state.
 * With an AI key the model reads it and every value is checked against the note; with no
 * key, a failed call, or too many reads in an hour, the built-in reader answers instead.
 */
export async function readPasteAction(text: string): Promise<PasteRead> {
  await requireRole("owner");
  const note = String(text ?? "").slice(0, PASTE_MAX_CHARS).trim();
  const rules = fillFromRules(note);
  if (!note || !pasteModelConfigured()) return { source: "rules", fill: rules, why: "no-key" };
  if (!(await allowRequest(PASTE_LIMIT))) return { source: "rules", fill: rules, why: "busy" };
  const today = todayDetroit();
  const answer = await readPasteWithModel(note, today);
  const fill = answer ? fillFromModel(answer, note, { today, limits: OWNER_JOB_LIMITS }) : null;
  return fill ? { source: "ai", fill } : { source: "rules", fill: rules, why: "failed" };
}

/** The owner types a phone or in-person job once: customer, work, firm price, and (optionally) the time. */
export async function createOwnerJobAction(form: FormData) {
  const actor = await requireRole("owner");
  const repo = getRepository();
  // Started from a lead: keep its details on the form if a check below sends the owner back.
  const leadId = field(form, "leadId");
  const newJobBack: (message: string) => never = (message) =>
    redirect(`/owner/jobs/new?${leadId ? `lead=${encodeURIComponent(leadId)}&` : ""}error=${encodeURIComponent(message)}`);
  const total = Number(field(form, "total").replace(/[$,]/g, ""));
  if (!Number.isFinite(total) || total <= 0) newJobBack("Enter the price as a dollar amount.");
  const travel = Number(field(form, "travel").replace(/[$,]/g, "") || "0");
  if (!Number.isFinite(travel) || travel < 0) newJobBack("Travel has to be a dollar amount, or blank.");
  const service = field(form, "service") as ServiceId;
  if (!(service in SERVICE_LABELS)) newJobBack("Pick a service.");
  const billingZip = field(form, "billingZip");
  if (billingZip && !/^\d{5}$/.test(billingZip)) newJobBack("The billing ZIP must be 5 digits, or blank.");
  if (!field(form, "fullName")) newJobBack("Enter the customer's name.");
  if (phoneDigits(field(form, "phone")).length < 7) newJobBack("Enter the customer's phone number.");
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
  // Work already done goes out as an invoice: no scheduling, due in full. Checked before the account is touched.
  const alreadyDone = field(form, "done") === "done";
  let doneOn: string | null = null;
  if (alreadyDone) {
    const checked = checkDoneOn(field(form, "doneOn"), todayDetroit());
    if (!checked.ok) newJobBack(checked.error);
    doneOn = checked.date;
  }
  // Finished work can be invoiced with no address at all; work to schedule needs one with a ZIP.
  const siteText = field(form, "jobSiteAddress") || field(form, "billingAddress") || billingZip;
  if (!alreadyDone) {
    if (!siteText) newJobBack("Add the job site address (or the billing address). The crew needs somewhere to go; only finished work can skip it.");
    if (!areaCheck(field(form, "jobSiteAddress") || billingZip || siteText, await repo.listZips()).found) newJobBack("Add a 5-digit ZIP to the job site address.");
  }

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
    doneOn,
    whiteLabel: form.get("whiteLabel") === "on",
    notBuilderWork: form.get("notBuilderWork") === "on",
  });
  if (!created.ok) newJobBack(created.error);
  const job = created.data;
  if (leadId) {
    const lead = await repo.getLead(leadId);
    if (lead && !lead.jobId) await repo.saveLead({ ...lead, jobId: job.id, updatedAt: new Date().toISOString() });
  }

  const notes = [doneOn ? `Invoice #${job.invoiceNumber} created for work done ${formatDate(doneOn)}.` : `Job added${job.invoiceNumber ? `, invoice #${job.invoiceNumber}` : ""}.`];
  const noEmail = !job.customerEmail;
  if (account.created) {
    notes.push(
      noEmail
        ? `Customer account created for ${job.customerName} (phone only, no email).`
        : password
          ? `Customer account created for ${account.user.email} with the temporary password you set.`
          : `Customer account created for ${account.user.email}. No password was set; the contract link works without one.`,
    );
  }
  if (noEmail) notes.push("No email on file, so nothing is sent automatically: copy the link and text it to them.");
  const settings = await repo.getSettings();
  if (!settings.licenseNumber && job.total >= settings.builderThreshold && builderRuleApplies(job)) {
    notes.push(`Heads up: this is $${Math.round(settings.builderThreshold)} or more and no license number is saved under Rates, so the agreement says a licensed contractor does the licensed part. If it isn't builder work, say so under Owner tools on the job page.`);
  }
  if (doneOn) {
    // Nothing to schedule: straight to the invoice, where the owner emails it or copies the link.
    notes.push(noEmail ? "Copy the link below and text it to them. Cash or a check gets marked paid on the job page." : "Email it to the customer below, or share the link. Cash or a check gets marked paid on the job page.");
    await settle(repo);
    redirect(`/jobs/${job.id}/contract?notice=${encodeURIComponent(notes.join(" "))}`);
  }
  // One scheduling step, from real open times: the job page lists them for this job. Holding
  // one emails the customer their link; or the owner emails the link and lets them choose.
  notes.push("Pick a time below and the customer gets their email the moment it's held, or email them the link to choose it themselves.");
  await settle(repo);
  jobBack(job.id, "notice", notes.join(" "));
}

/** Owner: let the customer choose the time. Emails them the link, which lists the open times. */
export async function emailPickTimeAction(form: FormData) {
  const actor = await requireRole("owner");
  const jobId = field(form, "jobId");
  const repo = getRepository();
  const result = await sendAgreement(repo, actor, jobId);
  await settle(repo);
  if (!result.ok) jobBack(jobId, "error", result.error);
  jobBack(
    jobId,
    "notice",
    resendConfigured()
      ? `Emailed ${result.data.customerEmail} the link to pick a time, sign, and pay.`
      : `Queued for ${result.data.customerEmail}; email isn't connected yet, so text them the link from the contract page instead.`,
  );
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

/** Owner: say whether Michigan's builder-license rule reaches this job. Changes one sentence in the contract. */
export async function builderWorkAction(form: FormData) {
  const jobId = field(form, "jobId");
  const notBuilderWork = field(form, "notBuilderWork") === "1";
  await mutate(
    jobId,
    notBuilderWork ? "Marked as not builder work. The contract now says nothing about the builder rule." : "Back to builder work. The contract says a licensed contractor does the licensed part.",
    (repo, actor) => setNotBuilderWork(repo, actor, jobId, notBuilderWork),
  );
}

/** Turn white-label on or off for a job: the owner, the signed-in customer, or whoever holds the job's link. */
export async function whiteLabelAction(form: FormData) {
  const jobId = field(form, "jobId");
  const token = field(form, "token") || null;
  const on = field(form, "on") === "1";
  if (!jobId) redirect("/");
  const back = (kind: "notice" | "error", message: string): never => (token ? contractBack(jobId, token, kind, message) : jobBack(jobId, kind, message));
  if (token && !(await allowRequest(ANON_LIMIT))) back("error", "Too many attempts from this network. Wait a few minutes and try again.");
  const actor = await currentActor();
  if (!actor && !token) redirect("/login");
  const repo = getRepository();
  const result = await setWhiteLabel(repo, { jobId, actor, token, on });
  await settle(repo);
  if (!result.ok) back("error", result.error);
  const ownerDidIt = actor?.role === "owner";
  back(
    "notice",
    !on
      ? "White-label is off for this job."
      : ownerDidIt
        ? "White-label is on for this job. The crew sees it on the job page, and no photos from it get posted."
        : "White-label is on for this job. We'll work as your company's technician and won't post photos.",
  );
}

// ---------------------------------------------------------------------------
// From the emailed contract link: no sign-in, the secret in the link is the key
// ---------------------------------------------------------------------------

function contractBack(jobId: string, token: string, kind: "notice" | "error", message: string): never {
  redirect(`/contract/${jobId}?k=${encodeURIComponent(token)}&${kind}=${encodeURIComponent(message)}`);
}

/** Pick a time from the emailed link. Holds it for the usual window, exactly as the job page does. */
export async function holdSlotLinkAction(form: FormData) {
  const jobId = field(form, "jobId");
  const token = field(form, "token");
  if (!jobId || !token) redirect("/");
  if (!(await allowRequest(ANON_LIMIT))) contractBack(jobId, token, "error", "Too many attempts from this network. Wait a few minutes and try again.");
  const repo = getRepository();
  const link = await jobForLink(repo, jobId, token);
  if (!link) redirect("/");
  const when = field(form, "when") === "earliest" ? "earliest" : { date: field(form, "date"), startMin: Number(form.get("startMin")) };
  const result = await holdSlot(repo, link.actor, jobId, when);
  await settle(repo);
  if (!result.ok) contractBack(jobId, token, "error", result.error);
  contractBack(jobId, token, "notice", paypalConfigured() ? "That time is held. Pay below to keep it." : "That time is held. We'll contact you to take the payment.");
}

/** Start PayPal from the emailed link. PayPal brings the customer back to this same link. */
export async function startPayPalLinkAction(form: FormData) {
  const jobId = field(form, "jobId");
  const token = field(form, "token");
  if (!jobId || !token) redirect("/");
  if (!(await allowRequest(ANON_LIMIT))) contractBack(jobId, token, "error", "Too many attempts from this network. Wait a few minutes and try again.");
  const repo = getRepository();
  const link = await jobForLink(repo, jobId, token);
  if (!link) redirect("/");
  const amount = amountPayable(link.job);
  if (amount <= 0) contractBack(jobId, token, "error", "Nothing is due on this job right now.");
  const linkQuery = `k=${encodeURIComponent(token)}`;
  let approveUrl = "";
  try {
    const order = await createPayPalOrder({
      amount,
      invoiceNumber: link.job.invoiceNumber,
      jobId,
      returnUrl: `${appUrl()}/api/paypal/return?job=${jobId}&${linkQuery}`,
      cancelUrl: `${appUrl()}/contract/${jobId}?${linkQuery}&notice=${encodeURIComponent("PayPal checkout was canceled. Nothing was charged.")}`,
    });
    link.job.paypalOrderId = order.id;
    await repo.saveJob(link.job, { skipOverlap: true });
    approveUrl = order.approveUrl;
  } catch (error) {
    const message = error instanceof Error ? error.message : "PayPal could not start checkout.";
    contractBack(jobId, token, "error", message);
  }
  redirect(approveUrl);
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
    // Our own email first: its link opens in any browser. Supabase's mailer is the fallback.
    if (resendConfigured() && (await sendResetEmail(email)) !== "failed") {
      redirect("/forgot?notice=" + encodeURIComponent(RESET_SENT));
    }
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

/** The button on /reset/open: swap the emailed one-time token for a session, then on to the new-password page. */
export async function openResetLinkAction(form: FormData) {
  const expired = "/forgot?error=" + encodeURIComponent("That link has expired or was already used. Only the newest email works. Ask for a new one below.");
  const tokenHash = field(form, "tokenHash");
  if (!tokenHash || !supabaseConfigured()) redirect(expired);
  if (!(await allowRequest(ANON_LIMIT))) {
    redirect("/forgot?error=" + encodeURIComponent("Too many attempts from this network. Wait a few minutes and try again."));
  }
  const supabase = await createSupabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
  if (error) {
    console.error("[auth] reset token verify failed", error.message);
    redirect(expired);
  }
  redirect("/reset");
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

// ---------------------------------------------------------------------------
// Owner price adjustments: discounts, and fixing an owner-entered write-up
// ---------------------------------------------------------------------------

export async function discountAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Discount applied. The invoice and contract show the new price.", (repo, actor) =>
    setDiscount(repo, actor, jobId, {
      amount: Number(field(form, "amount").replace(/[$,]/g, "")),
      reason: field(form, "reason"),
      notify: form.get("notify") === "on",
    }),
  );
}

export async function removeDiscountAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "Discount removed.", (repo, actor) => clearDiscount(repo, actor, jobId));
}

export async function editOwnerJobAction(form: FormData) {
  const jobId = field(form, "jobId");
  const hoursRaw = field(form, "hours");
  const daysRaw = field(form, "days");
  await mutate(jobId, "Job updated. The contract and invoice show the changes.", (repo, actor) =>
    editOwnerJob(repo, actor, jobId, {
      scope: field(form, "scope"),
      description: field(form, "description"),
      total: Number(field(form, "total").replace(/[$,]/g, "")),
      travel: Number(field(form, "travel").replace(/[$,]/g, "") || "0"),
      hoursOnSite: hoursRaw ? Number(hoursRaw) : null,
      days: daysRaw ? Number(daysRaw) : null,
      doneOn: field(form, "doneOn") || null,
    }),
  );
}

/** Owner: correct a customer's name, phone, email or billing address, on the account and all their jobs; optionally resend the document. */
export async function fixContactAction(form: FormData) {
  const jobId = field(form, "jobId");
  const resend = form.get("resend") === "on";
  const actor = await requireActor();
  const repo = getRepository();
  const result = await updateCustomerContact(repo, actor, jobId, {
    fullName: field(form, "fullName"),
    email: field(form, "email"),
    phone: field(form, "phone"),
    billingAddress: field(form, "billingAddress"),
    billingZip: field(form, "billingZip"),
  });
  if (!result.ok) {
    await settle(repo);
    jobBack(jobId, "error", result.error);
  }
  const notes = [`Contact details saved${result.jobsUpdated > 1 ? ` on all ${result.jobsUpdated} of their jobs` : ""}.`];
  const email = realEmail(result.user.email);
  if (resend && email) {
    const sent = await sendAgreement(repo, actor, jobId);
    notes.push(sent.ok ? `Sent again to ${email}.` : `Not resent: ${sent.error}`);
  } else if (resend) {
    notes.push("No email on file, so nothing was sent; text them the link from the contract page.");
  }
  await settle(repo);
  jobBack(jobId, "notice", notes.join(" "));
}

/** Owner: cancel an invoice for finished work that was written up by mistake (nothing paid). */
export async function voidInvoiceAction(form: FormData) {
  const jobId = field(form, "jobId");
  await mutate(jobId, "The invoice is voided. Nothing is due on it.", (repo, actor) => voidInvoice(repo, actor, jobId));
}
