import { randomUUID } from "node:crypto";
import { readJobDescription } from "@/lib/ai";
import type { Repository } from "@/lib/db/repository";
import {
  SlotTakenError,
  type Actor,
  type JobRecord,
  type JobStatus,
  type PaymentRecord,
  type WorkerRecord,
} from "@/lib/db/types";
import { areaCheck } from "@/lib/domain/area";
import { refundBeforeWork, validateOwnerRefund } from "@/lib/domain/cancellation";
import { roundCents } from "@/lib/domain/money";
import { crewNeeded, licenseEstimate, onsiteMinutes, quoteCalc, splitPayment } from "@/lib/domain/pricing";
import { classify } from "@/lib/domain/screening";
import {
  blocksSchedule,
  chooseCrew,
  previousJob,
  visitWindow,
  workerFree,
  type CrewCandidate,
} from "@/lib/domain/scheduling";
import { driveMinutes } from "@/lib/domain/travel";
import {
  DEFAULT_PARAMS,
  SERVICE_LABELS,
  type QuoteParams,
  type ScreenFlag,
  type ServiceId,
  type Settings,
} from "@/lib/domain/types";
import { addDays, formatDate, formatMinutes, jobUrl, nowMinutesDetroit, todayDetroit, usd, weekday } from "@/lib/format";
import { geocodeAddress, measureLeg, type Point } from "@/lib/mileage";

const SERVICE_IDS: ServiceId[] = ["paint", "tv", "blinds", "furniture", "yard", "clean", "helper", "other"];

export type SlotOption = {
  date: string;
  startMin: number;
  crewId: string;
  crewName: string;
  memberNames: string[];
  memberIds: string[];
  travelFrom: string;
  travelMiles: number;
  travelFee: number;
  total: number;
  dueNow: number;
  balance: number;
  tie: boolean;
};

export type RouteRow = {
  id: string;
  startMin: number;
  label: string;
  address: string;
  customer: string;
  status: JobStatus;
  liveMiles: number;
  billedMiles: number;
  locked: boolean;
  fromLabel: string;
  fee: number;
};

export type DayRoute = {
  crewId: string;
  crewName: string;
  members: string[];
  rows: RouteRow[];
  liveMiles: number;
};

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

function pointOf(job: Pick<JobRecord, "jobSiteAddress" | "jobLat" | "jobLng" | "zipMiles">): Point {
  return { address: job.jobSiteAddress, lat: job.jobLat, lng: job.jobLng, zipMiles: job.zipMiles };
}

export function amountPaid(payments: PaymentRecord[], jobId: string): number {
  return roundCents(
    payments
      .filter((p) => p.jobId === jobId && !p.closed && p.kind !== "refund" && p.status === "paid")
      .reduce((sum, p) => sum + p.amount, 0),
  );
}

function footer(settings: Settings): string {
  return `\n\neX Construction LC\n${settings.shopAddress}`;
}

async function ownerInbox(repo: Repository, settings: Settings): Promise<string> {
  if (settings.ownerNotifyEmail.trim()) return settings.ownerNotifyEmail.trim();
  if (process.env.OWNER_EMAIL?.trim()) return process.env.OWNER_EMAIL.trim();
  const users = await repo.listUsers();
  return users.find((user) => user.role === "owner")?.email ?? "";
}

async function mail(repo: Repository, to: string, subject: string, body: string, jobId: string | null) {
  if (!to.trim()) return;
  await repo.addEmail({
    id: randomUUID(),
    to,
    subject,
    body,
    jobId,
    sent: false,
    createdAt: new Date().toISOString(),
  });
}

async function notify(
  repo: Repository,
  settings: Settings,
  kind: "pay" | "approval" | "refund" | "done",
  title: string,
  detail: string,
  jobId: string | null,
) {
  await repo.addNotification({
    id: randomUUID(),
    kind,
    title,
    detail,
    read: false,
    jobId,
    createdAt: new Date().toISOString(),
  });
  const inbox = await ownerInbox(repo, settings);
  if (inbox) await mail(repo, inbox, title, `${detail}${footer(settings)}`, jobId);
}

function applyQuote(
  job: JobRecord,
  settings: Settings,
  miles: number | null,
  fromLabel: string,
  source: string,
) {
  const estimate = source !== "openrouteservice" && source !== "osrm";
  const quote = quoteCalc(job.service, job.params, settings, job.county, miles, {
    urgent: job.urgent,
    pickup: job.pickup,
    travelFrom: fromLabel,
    milesAreEstimate: estimate,
  });
  const split = splitPayment(quote.total, settings.depositThreshold);
  job.scope = quote.scope;
  job.lines = quote.lines;
  job.assumptions = quote.assumptions;
  job.total = quote.total;
  job.amountDueNow = split.now;
  job.balanceDue = split.later;
  job.payRule = split.rule;
  job.travelMiles = miles;
  job.travelFrom = fromLabel;
  job.travelFee = quote.lines.find((line) => line.kind === "travel")?.amount ?? 0;
  job.travelSource = source;
  job.driveMinutes = driveMinutes(miles ?? 0, settings.driveFactor, settings.drivePadMinutes);
  if (job.startMin != null) {
    const window = visitWindow(job.startMin, job.driveMinutes, job.onsiteMinutes, settings.bufferMinutes);
    job.reserveStartMin = window.reserveStart;
    job.reserveEndMin = window.reserveEnd;
  }
}

function clearSchedule(job: JobRecord) {
  job.crewId = null;
  job.workerIds = [];
  job.assignedBy = null;
  job.assignNote = "";
  job.scheduledDate = null;
  job.startMin = null;
  job.reserveStartMin = null;
  job.reserveEndMin = null;
  job.holdUntil = null;
}

async function releaseExpired(repo: Repository) {
  const jobs = await repo.listJobs();
  const now = Date.now();
  for (const job of jobs) {
    if (job.status === "held" && job.holdUntil && new Date(job.holdUntil).getTime() <= now) {
      const crewId = job.crewId;
      const date = job.scheduledDate;
      clearSchedule(job);
      job.status = "released";
      await repo.saveJob(job, { skipOverlap: true });
      if (crewId && date) {
        const settings = await repo.getSettings();
        await recalculateDay(repo, settings, date, crewId);
      }
    }
  }
}

function busyWindows(jobs: JobRecord[], workerId: string, date: string): [number, number][] {
  const windows: [number, number][] = [];
  for (const job of jobs) {
    if (job.scheduledDate !== date || !blocksSchedule(job.status)) continue;
    if (!job.workerIds.includes(workerId)) continue;
    if (job.reserveStartMin == null || job.reserveEndMin == null) continue;
    windows.push([job.reserveStartMin, job.reserveEndMin]);
  }
  return windows;
}

async function buildSlots(repo: Repository, job: JobRecord, settings: Settings): Promise<SlotOption[]> {
  const jobs = (await repo.listJobs()).filter((other) => other.id !== job.id);
  const workers = (await repo.listWorkers()).filter((worker) => worker.active && worker.crewId);
  const crews = (await repo.listCrews()).filter((crew) => crew.active);
  const timeOff = await repo.listTimeOff();
  const needed = crewNeeded(job.service, job.params, settings);
  const today = todayDetroit();
  const minuteNow = nowMinutesDetroit();
  const slots: SlotOption[] = [];
  const destination = pointOf(job);

  for (let offset = 0; offset < 14; offset++) {
    const date = addDays(today, offset);
    const day = weekday(date);
    const cache = new Map<string, { miles: number; fromLabel: string; drive: number }>();
    const leg = async (crewId: string, startMin: number) => {
      const prev = previousJob(
        jobs.filter((item) => item.scheduledDate === date),
        crewId,
        startMin,
      );
      const key = `${crewId}:${prev?.id ?? "shop"}`;
      const hit = cache.get(key);
      if (hit) return hit;
      const measured = prev
        ? await measureLeg(repo, settings, pointOf(prev), destination)
        : await measureLeg(repo, settings, "shop", destination);
      const value = {
        miles: measured.miles,
        fromLabel: measured.fromLabel,
        drive: driveMinutes(measured.miles, settings.driveFactor, settings.drivePadMinutes),
      };
      cache.set(key, value);
      return value;
    };

    for (let start = settings.slotStartMin; start <= settings.slotEndMin; start += settings.slotStepMin) {
      if (date === today && start <= minuteNow + 30) continue;
      const candidates: CrewCandidate[] = [];
      const legs = new Map<string, { miles: number; fromLabel: string; drive: number }>();
      for (const crew of crews) {
        const measured = await leg(crew.id, start);
        legs.set(crew.id, measured);
        const window = visitWindow(start, measured.drive, job.onsiteMinutes, settings.bufferMinutes);
        const free = workers.filter((worker) => {
          if (worker.crewId !== crew.id) return false;
          if (!worker.workDays.includes(day)) return false;
          if (timeOff.some((off) => off.workerId === worker.id && off.date === date)) return false;
          return workerFree(
            { dayStart: worker.dayStartMin, dayEnd: worker.dayEndMin },
            busyWindows(jobs, worker.id, date),
            window.reserveStart,
            window.reserveEnd,
          );
        });
        const jobCount = jobs.filter(
          (item) => item.scheduledDate === date && item.crewId === crew.id && item.startMin != null && blocksSchedule(item.status),
        ).length;
        candidates.push({
          crewId: crew.id,
          distanceMiles: measured.miles,
          jobCount,
          freeMemberIds: free.map((worker) => worker.id),
        });
      }

      let pool = candidates;
      if (job.preferredWorkerId) {
        if (!pool.some((candidate) => candidate.freeMemberIds.includes(job.preferredWorkerId!))) continue;
        pool = pool.map((candidate) =>
          candidate.freeMemberIds.includes(job.preferredWorkerId!)
            ? {
                ...candidate,
                distanceMiles: -0.001,
                jobCount: -1,
                freeMemberIds: [
                  job.preferredWorkerId!,
                  ...candidate.freeMemberIds.filter((id) => id !== job.preferredWorkerId),
                ],
              }
            : candidate,
        );
      }
      const choice = chooseCrew(pool, needed);
      if (!choice) continue;
      const info = legs.get(choice.crewId);
      if (!info) continue;
      const quote = quoteCalc(job.service, job.params, settings, job.county, info.miles, {
        urgent: job.urgent,
        pickup: job.pickup,
        travelFrom: info.fromLabel,
      });
      const split = splitPayment(quote.total, settings.depositThreshold);
      slots.push({
        date,
        startMin: start,
        crewId: choice.crewId,
        crewName: crews.find((crew) => crew.id === choice.crewId)?.name ?? "Crew",
        memberNames: choice.memberIds.map((id) => workers.find((worker) => worker.id === id)?.fullName ?? "Worker"),
        memberIds: choice.memberIds,
        travelFrom: info.fromLabel,
        travelMiles: info.miles,
        travelFee: quote.lines.find((line) => line.kind === "travel")?.amount ?? 0,
        total: quote.total,
        dueNow: split.now,
        balance: split.later,
        tie: choice.distanceTie,
      });
    }
  }
  return slots;
}

function placeOnSlot(job: JobRecord, settings: Settings, slot: SlotOption) {
  job.crewId = slot.crewId;
  job.workerIds = slot.memberIds;
  job.assignedBy = "auto";
  job.scheduledDate = slot.date;
  job.startMin = slot.startMin;
  job.onsiteMinutes = onsiteMinutes(job.service, job.params, settings);
  const tie = slot.tie ? "; tie, fewer jobs that day" : "";
  job.assignNote = `Auto-assigned: ${slot.crewName} (closest, ${slot.travelMiles.toFixed(1)} mi${tie})`;
  applyQuote(job, settings, slot.travelMiles, slot.travelFrom, job.travelSource || "straight-line");
}

async function recalculateDay(repo: Repository, settings: Settings, date: string, crewId: string) {
  const jobs = await repo.listJobs();
  const dayJobs = jobs
    .filter((job) => job.scheduledDate === date && job.crewId === crewId && job.startMin != null && blocksSchedule(job.status))
    .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
  for (const job of dayJobs) {
    if (job.travelLocked) continue;
    const prev = previousJob(dayJobs, crewId, job.startMin ?? 0);
    const measured = prev
      ? await measureLeg(repo, settings, pointOf(prev), pointOf(job))
      : await measureLeg(repo, settings, "shop", pointOf(job));
    applyQuote(job, settings, measured.miles, measured.fromLabel, measured.source);
    await repo.saveJob(job, { skipOverlap: true });
  }
}

function screenJob(job: JobRecord, settings: Settings, aiNote: string | null): ScreenFlag {
  const flag = classify(job.service, job.description, job.params, licenseEstimate({ scope: job.scope, lines: job.lines, assumptions: job.assumptions, total: job.total }), settings);
  if (flag.level === "ok" && aiNote) {
    return {
      level: "review",
      trade: "Possible license (AI screen)",
      why: aiNote,
      rule: "The keyword screen found nothing, and the AI screen asked for a person to look. Prices still come from the rate table.",
    };
  }
  if (aiNote && flag.level !== "ok") {
    return { ...flag, why: `${flag.why} AI note: ${aiNote}` };
  }
  return flag;
}

export async function createQuote(
  repo: Repository,
  actor: Actor,
  input: {
    service: ServiceId;
    description: string;
    params: QuoteParams;
    differentSite: boolean;
    jobSiteAddress: string;
    urgent: boolean;
    pickup: boolean;
    preferredWorkerId: string | null;
    photos: { id: string; name: string }[];
  },
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "customer" && actor.role !== "owner") return fail("Sign in as a customer to request work.");
    const user = await repo.getUser(actor.id);
    if (!user) return fail("Account not found.");
    if (!user.fullName.trim() || !user.phone.trim() || !user.billingAddress.trim() || !/^\d{5}$/.test(user.billingZip)) {
      return fail("Add your name, phone, and billing address (with ZIP) before requesting a quote.");
    }
    if (!SERVICE_IDS.includes(input.service)) return fail("Pick a service.");
    const description = input.description.trim();
    if (description.length < 8) return fail("Describe the job in a sentence or two.");
    if (input.photos.length > 6) return fail("You can attach up to 6 photos.");

    const jobSiteAddress = input.differentSite ? input.jobSiteAddress.trim() : user.billingAddress;
    const zips = await repo.listZips();
    const area = areaCheck(input.differentSite ? jobSiteAddress : user.billingZip || user.billingAddress, zips);
    if (!area.found) return fail("Add a 5-digit ZIP to the job-site address.");

    const settings = await repo.getSettings();
    let lat = area.lat;
    let lng = area.lng;
    const geocoded = await geocodeAddress(repo, jobSiteAddress);
    if (geocoded) {
      lat = geocoded.lat;
      lng = geocoded.lng;
    }
    const measured = await measureLeg(repo, settings, "shop", {
      address: jobSiteAddress,
      lat,
      lng,
      zipMiles: area.milesFromCadillac,
    });

    const job: JobRecord = {
      id: randomUUID(),
      customerId: user.id,
      customerName: user.fullName,
      customerEmail: user.email,
      customerPhone: user.phone,
      service: input.service,
      description,
      params: { ...DEFAULT_PARAMS, ...input.params },
      billingAddress: user.billingAddress,
      jobSiteAddress,
      differentSite: input.differentSite,
      jobZip: area.zip,
      county: area.county,
      city: area.city,
      areaAuto: area.auto,
      areaLabel: area.label,
      areaDetail: area.detail,
      jobLat: lat,
      jobLng: lng,
      zipMiles: area.milesFromCadillac,
      scope: "",
      lines: [],
      assumptions: [],
      total: 0,
      amountDueNow: 0,
      balanceDue: 0,
      payRule: "",
      licenseLevel: "ok",
      licenseTrade: "",
      licenseWhy: "",
      licenseRule: "",
      referralNote: "",
      urgent: input.urgent && input.service !== "helper",
      pickup: input.pickup && input.service !== "helper",
      photos: input.photos.slice(0, 6),
      preferredWorkerId: input.preferredWorkerId,
      crewId: null,
      workerIds: [],
      assignedBy: null,
      assignNote: "",
      scheduledDate: null,
      startMin: null,
      onsiteMinutes: onsiteMinutes(input.service, { ...DEFAULT_PARAMS, ...input.params }, settings),
      driveMinutes: 0,
      reserveStartMin: null,
      reserveEndMin: null,
      travelMiles: null,
      travelFrom: "",
      travelFee: 0,
      travelLocked: false,
      travelSource: measured.source,
      status: "quoted",
      priorStatus: null,
      holdUntil: null,
      invoiceNumber: null,
      paypalOrderId: null,
      completionNote: "",
      problemNote: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    applyQuote(job, settings, measured.miles, measured.fromLabel, measured.source);
    const ai = await readJobDescription(input.service, description);
    if (ai.scopeHint) job.assumptions = [`From your description: ${ai.scopeHint}`, ...job.assumptions];
    if (ai.assumptions.length) job.assumptions = [...job.assumptions, ...ai.assumptions];
    const flag = screenJob(job, settings, ai.licenseNote);
    job.licenseLevel = flag.level;
    job.licenseTrade = flag.trade;
    job.licenseWhy = flag.why;
    job.licenseRule = flag.rule;
    if (flag.level !== "ok") job.status = "scope_review";
    else if (!area.auto) job.status = "pending_area";
    else job.status = "quoted";

    const saved = await repo.saveJob(job, { skipOverlap: true });
    if (saved.status === "scope_review") {
      await notify(
        repo,
        settings,
        "approval",
        `License review needed: ${flag.trade}`,
        `${user.fullName}: "${description}". ${flag.why}`,
        saved.id,
      );
      await mail(
        repo,
        user.email,
        "Thanks! We're reviewing your request",
        `Hi ${user.fullName}, thanks for the details. Part of this job may need a licensed trade, so the owner is reviewing it personally. We'll get back to you within 1 business day with a quote or a referral.${footer(settings)}`,
        saved.id,
      );
    }
    return { ok: true, data: saved };
  });
}

export async function listOpenSlots(repo: Repository, actor: Actor, jobId: string): Promise<Ok<SlotOption[]> | Err> {
  return repo.run(async () => {
    await releaseExpired(repo);
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role === "customer" && job.customerId !== actor.id) return fail("That job belongs to another customer.");
    if (!["quoted", "released", "pending_area"].includes(job.status)) {
      return fail("This job isn't waiting on a time.");
    }
    if (job.licenseLevel !== "ok" && job.status !== "pending_area") {
      return fail("The owner is still reviewing whether we can do this work.");
    }
    const settings = await repo.getSettings();
    const slots = await buildSlots(repo, job, settings);
    return { ok: true, data: slots };
  });
}

export async function holdSlot(
  repo: Repository,
  actor: Actor,
  jobId: string,
  when: { date: string; startMin: number } | "earliest",
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    try {
      await releaseExpired(repo);
      const job = await repo.getJob(jobId);
      if (!job) return fail("Job not found.");
      if (actor.role !== "owner" && job.customerId !== actor.id) return fail("That job belongs to another customer.");
      if (!["quoted", "released", "pending_area"].includes(job.status)) return fail("This job can't be booked from its current step.");
      if (job.licenseLevel !== "ok") return fail("The owner has to clear this job before a time can be held.");
      const settings = await repo.getSettings();
      const slots = await buildSlots(repo, job, settings);
      const slot = when === "earliest" ? slots[0] : slots.find((item) => item.date === when.date && item.startMin === when.startMin);
      if (!slot) return fail(slots.length === 0 ? "No opening in the next two weeks fits this job." : "That opening is gone. Pick another.");
      placeOnSlot(job, settings, slot);
      const tentative = !job.areaAuto;
      if (tentative) {
        job.status = "pending_area";
        job.holdUntil = null;
        job.assignNote = `${job.assignNote} Tentative until the owner approves this ZIP. The 24-hour payment clock starts at approval.`;
      } else {
        job.status = "held";
        job.holdUntil = new Date(Date.now() + settings.holdHours * 3600 * 1000).toISOString();
      }
      const saved = await repo.saveJob(job, { issueInvoice: job.status === "held" && job.invoiceNumber == null });
      if (saved.crewId && saved.scheduledDate) await recalculateDay(repo, settings, saved.scheduledDate, saved.crewId);
      const fresh = (await repo.getJob(saved.id)) ?? saved;
      if (fresh.status === "held") {
        await mail(
          repo,
          fresh.customerEmail,
          "Booking confirmation: your slot is held for 24 hours",
          `Hi ${fresh.customerName}, we're holding ${formatDate(fresh.scheduledDate || "")} at ${formatMinutes(fresh.startMin || 0)} for ${fresh.scope}. Invoice #${fresh.invoiceNumber}. Invoice total ${usd(fresh.total)}. Pay ${usd(fresh.amountDueNow)} ${fresh.balanceDue > 0 ? "(50% down)" : "(full amount)"} within ${settings.holdHours} hours to confirm, or the slot is released.\n\nPay here: ${jobUrl(fresh.id)}\n${fresh.balanceDue > 0 ? `The ${usd(fresh.balanceDue)} balance is due after the work is complete and you approve it.` : ""}${footer(settings)}`,
          fresh.id,
        );
      } else {
        await notify(
          repo,
          settings,
          "approval",
          `Area review: ${fresh.jobZip} ${fresh.city}`,
          `${fresh.customerName} requested ${fresh.scope}. ${fresh.areaDetail}`,
          fresh.id,
        );
        await mail(
          repo,
          fresh.customerEmail,
          "We received your time request",
          `Hi ${fresh.customerName}, ${fresh.areaLabel}. Dale will look at ${fresh.jobSiteAddress} before the 24-hour payment clock starts.${fresh.scheduledDate ? ` You asked for ${formatDate(fresh.scheduledDate)} at ${formatMinutes(fresh.startMin || 0)}.` : ""}${footer(settings)}`,
          fresh.id,
        );
      }
      return { ok: true, data: fresh };
    } catch (error) {
      if (error instanceof SlotTakenError) return fail(error.message);
      throw error;
    }
  });
}

export async function releaseHold(repo: Repository, actor: Actor, jobId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role !== "owner" && job.customerId !== actor.id) return fail("That job belongs to another customer.");
    if (job.status !== "held" && !(job.status === "pending_area" && job.scheduledDate)) return fail("There isn't a hold to release.");
    const crewId = job.crewId;
    const date = job.scheduledDate;
    clearSchedule(job);
    if (job.status === "held") job.status = "released";
    const saved = await repo.saveJob(job, { skipOverlap: true });
    const settings = await repo.getSettings();
    if (crewId && date) await recalculateDay(repo, settings, date, crewId);
    return { ok: true, data: (await repo.getJob(saved.id)) ?? saved };
  });
}

export async function payJob(
  repo: Repository,
  actor: Actor,
  jobId: string,
  method: "paypal" | "cash" | "check",
  paypalCaptureId: string | null = null,
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    await releaseExpired(repo);
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (method !== "paypal" && actor.role !== "owner") return fail("Only the owner can mark cash or a check as paid.");
    if (actor.role === "customer" && job.customerId !== actor.id) return fail("That job belongs to another customer.");
    if (actor.role === "worker") return fail("Workers don't record payments.");
    const payments = await repo.listPayments(jobId);
    if (paypalCaptureId && payments.some((payment) => payment.paypalCaptureId === paypalCaptureId)) {
      return { ok: true, data: job };
    }
    const settings = await repo.getSettings();
    if (job.status === "held") {
      if (job.holdUntil && new Date(job.holdUntil).getTime() <= Date.now()) {
        return fail("The hold expired. Pick a new time.");
      }
      const kind = job.balanceDue > 0 ? "deposit" : "full";
      await repo.savePayment({
        id: randomUUID(),
        jobId,
        kind,
        amount: job.amountDueNow,
        method,
        status: "paid",
        closed: false,
        note: kind === "deposit" ? "Deposit (50%)" : "Full payment",
        paypalCaptureId,
        createdAt: new Date().toISOString(),
      });
      job.status = "booked";
      job.holdUntil = null;
      job.travelLocked = true;
      const saved = await repo.saveJob(job, { skipOverlap: true });
      await mail(
        repo,
        saved.customerEmail,
        `Receipt for invoice #${saved.invoiceNumber}: ${usd(saved.amountDueNow)} paid, you're booked`,
        `Hi ${saved.customerName}, we received ${usd(saved.amountDueNow)} (${method}) for ${saved.scope}${saved.scheduledDate ? ` on ${formatDate(saved.scheduledDate)} at ${formatMinutes(saved.startMin || 0)}` : ""}. ${saved.balanceDue > 0 ? `The ${usd(saved.balanceDue)} balance is due once the work is complete and you approve it.` : "You're paid in full."} Need to cancel or reschedule before work starts? A ${usd(settings.cancelFee)} processing fee is kept and the rest is refunded.${footer(settings)}`,
        saved.id,
      );
      await notify(
        repo,
        settings,
        "pay",
        `Payment received: ${usd(saved.amountDueNow)} ${saved.balanceDue > 0 ? "50% deposit" : "full payment"}`,
        `${saved.scope}; ${method}. ${saved.balanceDue > 0 ? `${usd(saved.balanceDue)} balance due after completion and customer approval.` : "Paid in full."}`,
        saved.id,
      );
      return { ok: true, data: saved };
    }
    if (job.status === "balance_due") {
      await repo.savePayment({
        id: randomUUID(),
        jobId,
        kind: "balance",
        amount: job.balanceDue,
        method,
        status: "paid",
        closed: false,
        note: "Balance",
        paypalCaptureId,
        createdAt: new Date().toISOString(),
      });
      const paid = job.balanceDue;
      job.balanceDue = 0;
      job.amountDueNow = 0;
      job.status = "completed";
      const saved = await repo.saveJob(job, { skipOverlap: true });
      await mail(
        repo,
        saved.customerEmail,
        `Receipt for invoice #${saved.invoiceNumber}: ${usd(paid)} balance paid`,
        `Hi ${saved.customerName}, we received your ${usd(paid)} balance (${method}) for ${saved.scope}. Your job is fully paid (${usd(saved.total)} total). We'd love a review: ${jobUrl(saved.id)}${footer(settings)}`,
        saved.id,
      );
      await notify(repo, settings, "pay", `Payment received: ${usd(paid)} balance`, `${saved.scope}; ${method}. Job is fully paid.`, saved.id);
      return { ok: true, data: saved };
    }
    return fail("Nothing is due on this job right now.");
  });
}

async function requireWorkerOrOwner(repo: Repository, actor: Actor, job: JobRecord): Promise<string | null> {
  if (actor.role === "owner") return null;
  if (actor.role !== "worker" || !actor.workerId) return "Only the assigned crew can update this job.";
  const allowed = job.workerIds.includes(actor.workerId) || job.crewId != null;
  if (!allowed) return "This job isn't on your list.";
  const workers = await repo.listWorkers();
  const me = workers.find((worker) => worker.id === actor.workerId);
  if (job.workerIds.includes(actor.workerId) || (me && me.crewId === job.crewId)) return null;
  return "This job isn't on your list.";
}

export async function startWork(repo: Repository, actor: Actor, jobId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    const denied = await requireWorkerOrOwner(repo, actor, job);
    if (denied) return fail(denied);
    if (job.status !== "booked") return fail("Work can start once the job is booked and paid.");
    job.status = "in_progress";
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }) };
  });
}

export async function completeWork(
  repo: Repository,
  actor: Actor,
  jobId: string,
  note: string,
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    const denied = await requireWorkerOrOwner(repo, actor, job);
    if (denied) return fail(denied);
    if (job.status !== "in_progress") return fail("Start the job before marking it complete.");
    job.status = "awaiting_approval";
    job.completionNote = note.trim();
    const saved = await repo.saveJob(job, { skipOverlap: true });
    const settings = await repo.getSettings();
    await mail(
      repo,
      saved.customerEmail,
      `Invoice #${saved.invoiceNumber}: your job is complete, please review and approve`,
      `Hi ${saved.customerName}, our crew marked ${saved.scope} complete. Please check the work and approve it.${saved.balanceDue > 0 ? ` After you approve, the ${usd(saved.balanceDue)} balance is due.` : ""} Something not right? Report a problem on the job page: ${jobUrl(saved.id)}${footer(settings)}`,
      saved.id,
    );
    await notify(
      repo,
      settings,
      "done",
      "Work complete: awaiting customer approval",
      `${saved.scope}. The crew marked the job complete; the customer hasn't approved it yet.${saved.balanceDue > 0 ? ` ${usd(saved.balanceDue)} balance is due once they approve.` : ""}`,
      saved.id,
    );
    return { ok: true, data: saved };
  });
}

export async function approveWork(repo: Repository, actor: Actor, jobId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role !== "owner" && job.customerId !== actor.id) return fail("Only the customer can approve the work.");
    if (job.status !== "awaiting_approval") return fail("The job isn't waiting for approval.");
    job.status = job.balanceDue > 0 ? "balance_due" : "completed";
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }) };
  });
}

export async function reportProblem(repo: Repository, actor: Actor, jobId: string, note: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (job.customerId !== actor.id && actor.role !== "owner") return fail("You can't report a problem on this job.");
    if (!["awaiting_approval", "balance_due", "in_progress"].includes(job.status)) return fail("This job isn't in a step that can be disputed.");
    job.priorStatus = job.status;
    job.status = "disputed";
    job.problemNote = note.trim();
    const saved = await repo.saveJob(job, { skipOverlap: true });
    const settings = await repo.getSettings();
    await notify(repo, settings, "approval", "Customer reported a problem", `${saved.customerName} on ${saved.scope}: ${saved.problemNote || "No note."}`, saved.id);
    return { ok: true, data: saved };
  });
}

export async function resumeAfterProblem(repo: Repository, actor: Actor, jobId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can clear a problem report.");
    const job = await repo.getJob(jobId);
    if (!job || job.status !== "disputed") return fail("This job doesn't have an open problem.");
    job.status = job.priorStatus && job.priorStatus !== "disputed" && job.priorStatus !== "cancel_requested" ? job.priorStatus : "awaiting_approval";
    job.priorStatus = null;
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }) };
  });
}

function closePayments(payments: PaymentRecord[]) {
  return payments.map((payment) => ({ ...payment, closed: true }));
}

export async function cancelBeforeWork(
  repo: Repository,
  actor: Actor,
  jobId: string,
  kind: "cancel" | "reschedule",
): Promise<Ok<{ job: JobRecord; fee: number; refund: number }> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (actor.role !== "owner" && job.customerId !== actor.id) return fail("That job belongs to another customer.");
    if (job.status !== "booked") return fail("Once work has started, cancellation has to be requested and approved.");
    const settings = await repo.getSettings();
    const payments = await repo.listPayments(jobId);
    const paid = amountPaid(payments, jobId);
    const refund = refundBeforeWork(paid, settings.cancelFee);
    for (const payment of closePayments(payments)) await repo.savePayment(payment);
    await repo.savePayment({
      id: randomUUID(),
      jobId,
      kind: "refund",
      amount: refund.refund,
      method: "paypal",
      status: refund.refund > 0 ? "pending" : "sent",
      closed: false,
      note: refund.note,
      paypalCaptureId: null,
      createdAt: new Date().toISOString(),
    });
    const crewId = job.crewId;
    const date = job.scheduledDate;
    if (kind === "cancel") {
      clearSchedule(job);
      job.status = "cancelled";
    } else {
      clearSchedule(job);
      job.status = "quoted";
      job.travelLocked = false;
    }
    const saved = await repo.saveJob(job, { skipOverlap: true });
    if (crewId && date) await recalculateDay(repo, settings, date, crewId);
    const verb = kind === "cancel" ? "cancelled" : "rescheduled";
    await mail(
      repo,
      saved.customerEmail,
      kind === "cancel" ? `Invoice #${saved.invoiceNumber}: your booking is cancelled` : `Invoice #${saved.invoiceNumber}: rescheduled, pick a new time`,
      `Hi ${saved.customerName}, you paid ${usd(paid)} for ${saved.scope}. A ${usd(refund.fee)} processing fee is kept${refund.refund > 0 ? ` and ${usd(refund.refund)} will be refunded to your original PayPal payment.` : `. Because ${usd(settings.cancelFee)} or less was paid, the refund is $0.`}${kind === "reschedule" ? ` Pick a new time: ${jobUrl(saved.id)}` : ""}${footer(settings)}`,
      saved.id,
    );
    await notify(
      repo,
      settings,
      "refund",
      `Customer ${verb}: ${refund.refund > 0 ? `${usd(refund.refund)} refund to send` : `$0 refund (paid ${usd(settings.cancelFee)} or less)`}`,
      `${saved.scope}. Paid ${usd(paid)}; ${usd(refund.fee)} kept as the processing fee.`,
      saved.id,
    );
    return { ok: true, data: { job: (await repo.getJob(saved.id)) ?? saved, fee: refund.fee, refund: refund.refund } };
  });
}

export async function requestCancel(repo: Repository, actor: Actor, jobId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (job.customerId !== actor.id && actor.role !== "owner") return fail("That job belongs to another customer.");
    if (!["in_progress", "awaiting_approval", "balance_due", "disputed"].includes(job.status)) {
      return fail("This step doesn't take a cancellation request.");
    }
    if (job.status === "cancel_requested") return fail("A cancellation request is already waiting.");
    job.priorStatus = job.status === "disputed" && job.priorStatus ? job.priorStatus : job.status;
    job.status = "cancel_requested";
    const saved = await repo.saveJob(job, { skipOverlap: true });
    const settings = await repo.getSettings();
    const paid = amountPaid(await repo.listPayments(jobId), jobId);
    await notify(
      repo,
      settings,
      "refund",
      "Cancellation requested: work has begun, needs your approval",
      `${saved.scope}, invoice #${saved.invoiceNumber}. Paid ${usd(paid)}. Approve with a refund amount you enter, or decline.`,
      saved.id,
    );
    await mail(
      repo,
      saved.customerEmail,
      `Invoice #${saved.invoiceNumber}: we received your cancellation request`,
      `Hi ${saved.customerName}, work on ${saved.scope} has already begun, so the owner reviews your request. We'll email you once it's approved (with any refund) or declined.${footer(settings)}`,
      saved.id,
    );
    return { ok: true, data: saved };
  });
}

export async function resolveCancel(
  repo: Repository,
  actor: Actor,
  jobId: string,
  decision: "approve" | "decline",
  refundRaw: string,
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can decide a cancellation after work has started.");
    const job = await repo.getJob(jobId);
    if (!job || job.status !== "cancel_requested") return fail("There isn't a cancellation request on this job.");
    const settings = await repo.getSettings();
    if (decision === "decline") {
      job.status = job.priorStatus && job.priorStatus !== "cancel_requested" ? job.priorStatus : "in_progress";
      job.priorStatus = null;
      const saved = await repo.saveJob(job, { skipOverlap: true });
      await mail(
        repo,
        saved.customerEmail,
        `Invoice #${saved.invoiceNumber}: cancellation request declined`,
        `Hi ${saved.customerName}, the owner declined the cancellation request for ${saved.scope}, so the job continues as booked.${footer(settings)}`,
        saved.id,
      );
      return { ok: true, data: saved };
    }
    const paid = amountPaid(await repo.listPayments(jobId), jobId);
    const check = validateOwnerRefund(refundRaw, paid);
    if (!check.ok) return fail(check.error);
    const payments = await repo.listPayments(jobId);
    for (const payment of closePayments(payments)) await repo.savePayment(payment);
    await repo.savePayment({
      id: randomUUID(),
      jobId,
      kind: "refund",
      amount: check.refund,
      method: "paypal",
      status: check.refund > 0 ? "pending" : "sent",
      closed: false,
      note: "Owner decision after work began",
      paypalCaptureId: null,
      createdAt: new Date().toISOString(),
    });
    const crewId = job.crewId;
    const date = job.scheduledDate;
    clearSchedule(job);
    job.status = "cancelled";
    const saved = await repo.saveJob(job, { skipOverlap: true });
    if (crewId && date) await recalculateDay(repo, settings, date, crewId);
    await mail(
      repo,
      saved.customerEmail,
      `Invoice #${saved.invoiceNumber}: cancellation approved`,
      `Hi ${saved.customerName}, your cancellation of ${saved.scope} is approved. You paid ${usd(paid)}; ${check.refund > 0 ? `${usd(check.refund)} will be refunded through PayPal` : "no refund is due"} and ${usd(check.kept)} is kept for work already done.${footer(settings)}`,
      saved.id,
    );
    return { ok: true, data: (await repo.getJob(saved.id)) ?? saved };
  });
}

export async function markRefundSent(repo: Repository, actor: Actor, paymentId: string): Promise<Ok<PaymentRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can mark a refund sent.");
    const payments = await repo.listPayments();
    const payment = payments.find((item) => item.id === paymentId);
    if (!payment || payment.kind !== "refund") return fail("Refund not found.");
    if (payment.status === "sent") return { ok: true, data: payment };
    payment.status = "sent";
    await repo.savePayment(payment);
    const job = await repo.getJob(payment.jobId);
    const settings = await repo.getSettings();
    if (job && payment.amount > 0) {
      await mail(
        repo,
        job.customerEmail,
        `Invoice #${job.invoiceNumber}: refund sent, ${usd(payment.amount)}`,
        `Hi ${job.customerName}, we've refunded ${usd(payment.amount)} through PayPal. It can take a few days to show up.${footer(settings)}`,
        job.id,
      );
    }
    return { ok: true, data: payment };
  });
}

export async function releaseLicense(repo: Repository, actor: Actor, jobId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can release a quote.");
    const job = await repo.getJob(jobId);
    if (!job || job.status !== "scope_review") return fail("This job isn't in license review.");
    job.licenseLevel = "ok";
    job.status = job.areaAuto ? "quoted" : "pending_area";
    const saved = await repo.saveJob(job, { skipOverlap: true });
    const settings = await repo.getSettings();
    await mail(
      repo,
      saved.customerEmail,
      `Your quote: ${usd(saved.total)}`,
      `Hi ${saved.customerName}, good news: we've confirmed we can do this job. Total ${usd(saved.total)}; ${usd(saved.amountDueNow)} due to book. Pick a time: ${jobUrl(saved.id)}${footer(settings)}`,
      saved.id,
    );
    return { ok: true, data: saved };
  });
}

export async function referOut(repo: Repository, actor: Actor, jobId: string, note: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can refer a job out.");
    const job = await repo.getJob(jobId);
    if (!job || (job.status !== "scope_review" && job.status !== "pending_area")) return fail("This job isn't waiting on a review.");
    job.status = "referred";
    job.referralNote = note.trim();
    const crewId = job.crewId;
    const date = job.scheduledDate;
    clearSchedule(job);
    const saved = await repo.saveJob(job, { skipOverlap: true });
    const settings = await repo.getSettings();
    if (crewId && date) await recalculateDay(repo, settings, date, crewId);
    await mail(
      repo,
      saved.customerEmail,
      "About your request: a referral",
      `Hi ${saved.customerName}, this job needs a licensed ${saved.licenseTrade.toLowerCase()} contractor, so we can't quote it ourselves.${saved.referralNote ? ` ${saved.referralNote}` : ""} We're happy to help with anything else.${footer(settings)}`,
      saved.id,
    );
    return { ok: true, data: saved };
  });
}

export async function decideArea(
  repo: Repository,
  actor: Actor,
  jobId: string,
  decision: "approve" | "decline",
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can approve an address.");
    const job = await repo.getJob(jobId);
    if (!job || job.status !== "pending_area") return fail("This job isn't waiting on an area decision.");
    const settings = await repo.getSettings();
    if (decision === "decline") {
      const crewId = job.crewId;
      const date = job.scheduledDate;
      clearSchedule(job);
      job.status = "declined";
      const saved = await repo.saveJob(job, { skipOverlap: true });
      if (crewId && date) await recalculateDay(repo, settings, date, crewId);
      await mail(
        repo,
        saved.customerEmail,
        "About your request",
        `Hi ${saved.customerName}, we can't book ${saved.jobSiteAddress} automatically, and the owner declined this one. Call or write us if you want to talk it through.${footer(settings)}`,
        saved.id,
      );
      return { ok: true, data: saved };
    }
    job.areaAuto = true;
    if (job.scheduledDate && job.startMin != null && job.workerIds.length > 0) {
      job.status = "held";
      job.holdUntil = new Date(Date.now() + settings.holdHours * 3600 * 1000).toISOString();
    } else {
      clearSchedule(job);
      job.status = "quoted";
    }
    let saved: JobRecord;
    try {
      saved = await repo.saveJob(job, { issueInvoice: job.status === "held" && job.invoiceNumber == null });
    } catch (error) {
      if (error instanceof SlotTakenError) return fail("That time was taken while you were deciding. The customer can pick another.");
      throw error;
    }
    const fresh = (await repo.getJob(saved.id)) ?? saved;
    await mail(
      repo,
      fresh.customerEmail,
      fresh.status === "held" ? "Your time is held for 24 hours" : "Your address is approved",
      fresh.status === "held"
        ? `Hi ${fresh.customerName}, Dale approved ${fresh.jobSiteAddress}. We're holding ${formatDate(fresh.scheduledDate || "")} at ${formatMinutes(fresh.startMin || 0)}. Pay ${usd(fresh.amountDueNow)} within ${settings.holdHours} hours: ${jobUrl(fresh.id)}${footer(settings)}`
        : `Hi ${fresh.customerName}, Dale approved ${fresh.jobSiteAddress}. Pick a time to hold your slot: ${jobUrl(fresh.id)}${footer(settings)}`,
      fresh.id,
    );
    return { ok: true, data: fresh };
  });
}

export async function reassignCrew(repo: Repository, actor: Actor, jobId: string, crewId: string): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can reassign a crew.");
    const job = await repo.getJob(jobId);
    if (!job || !job.scheduledDate || job.startMin == null) return fail("Book a time before reassigning.");
    if (!blocksSchedule(job.status)) return fail("This job isn't on the schedule.");
    const crews = await repo.listCrews();
    const crew = crews.find((item) => item.id === crewId && item.active);
    if (!crew) return fail("Pick an active crew.");
    const settings = await repo.getSettings();
    const workers = (await repo.listWorkers()).filter((worker) => worker.active && worker.crewId === crewId);
    const needed = crewNeeded(job.service, job.params, settings);
    if (workers.length < needed) return fail(`${crew.name} doesn't have ${needed} active worker${needed === 1 ? "" : "s"}.`);
    const previousCrew = job.crewId;
    const date = job.scheduledDate;
    job.crewId = crewId;
    job.workerIds = workers.slice(0, needed).map((worker) => worker.id);
    job.assignedBy = "owner";
    if (!job.travelLocked) {
      const jobs = (await repo.listJobs()).filter((item) => item.id !== job.id);
      const prev = previousJob(
        jobs.filter((item) => item.scheduledDate === date),
        crewId,
        job.startMin,
      );
      const measured = prev
        ? await measureLeg(repo, settings, pointOf(prev), pointOf(job))
        : await measureLeg(repo, settings, "shop", pointOf(job));
      applyQuote(job, settings, measured.miles, measured.fromLabel, measured.source);
      job.assignNote = `Reassigned by owner: ${crew.name}. Travel recalculated from ${measured.fromLabel}.`;
    } else {
      job.assignNote = `Reassigned by owner: ${crew.name}. Paid travel stays locked at ${job.travelMiles ?? 0} mi.`;
    }
    try {
      const saved = await repo.saveJob(job);
      if (previousCrew && previousCrew !== crewId) await recalculateDay(repo, settings, date, previousCrew);
      await recalculateDay(repo, settings, date, crewId);
      return { ok: true, data: (await repo.getJob(saved.id)) ?? saved };
    } catch (error) {
      if (error instanceof SlotTakenError) return fail(`${crew.name} is already booked across that visit.`);
      throw error;
    }
  });
}

export async function saveReview(
  repo: Repository,
  actor: Actor,
  jobId: string,
  rating: number,
  comment: string,
  publishPhotos: boolean,
): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    const job = await repo.getJob(jobId);
    if (!job) return fail("Job not found.");
    if (job.customerId !== actor.id) return fail("Only the customer on this job can review it.");
    if (job.status !== "completed" && job.status !== "reviewed") return fail("You can review the job after it's finished and paid.");
    const stars = Math.min(5, Math.max(1, Math.round(rating)));
    await repo.saveReview({
      jobId,
      customerId: actor.id,
      customerName: job.customerName,
      rating: stars,
      comment: comment.trim(),
      publishPhotos,
      createdAt: new Date().toISOString(),
    });
    job.status = "reviewed";
    return { ok: true, data: await repo.saveJob(job, { skipOverlap: true }) };
  });
}

export async function dayRoute(repo: Repository, date: string): Promise<DayRoute[]> {
  return repo.run(async () => {
    await releaseExpired(repo);
    const settings = await repo.getSettings();
    const jobs = await repo.listJobs();
    const crews = await repo.listCrews();
    const workers = await repo.listWorkers();
    const routes: DayRoute[] = [];
    for (const crew of crews.filter((item) => item.active)) {
      const stops = jobs
        .filter((job) => job.scheduledDate === date && job.crewId === crew.id && job.startMin != null && blocksSchedule(job.status))
        .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
      let previous: JobRecord | null = null;
      let liveMiles = 0;
      const rows: RouteRow[] = [];
      for (const job of stops) {
        const measured = previous
          ? await measureLeg(repo, settings, pointOf(previous), pointOf(job))
          : await measureLeg(repo, settings, "shop", pointOf(job));
        liveMiles += measured.miles;
        const locked = job.travelLocked && job.travelMiles != null;
        rows.push({
          id: job.id,
          startMin: job.startMin ?? 0,
          label: job.scope || SERVICE_LABELS[job.service],
          address: job.jobSiteAddress,
          customer: job.customerName,
          status: job.status,
          liveMiles: measured.miles,
          billedMiles: locked ? (job.travelMiles as number) : (job.travelMiles ?? measured.miles),
          locked,
          fromLabel: previous ? `Job to job, from ${previous.jobSiteAddress}` : "Shop to job 1",
          fee: job.travelFee,
        });
        previous = job;
      }
      routes.push({
        crewId: crew.id,
        crewName: crew.name,
        members: workers.filter((worker) => worker.crewId === crew.id && worker.active).map((worker) => worker.fullName),
        rows,
        liveMiles,
      });
    }
    return routes;
  });
}

export async function visibleTo(repo: Repository, actor: Actor, job: JobRecord): Promise<boolean> {
  if (actor.role === "owner") return true;
  if (actor.role === "customer") return job.customerId === actor.id;
  if (!actor.workerId) return false;
  if (job.workerIds.includes(actor.workerId)) return true;
  const workers = await repo.listWorkers();
  const me = workers.find((worker) => worker.id === actor.workerId);
  return Boolean(me?.crewId && me.crewId === job.crewId && blocksSchedule(job.status));
}
