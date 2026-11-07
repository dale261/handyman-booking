import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, JobRecord, UserRecord } from "@/lib/db/types";
import { longDate, ownerPriceLines } from "@/lib/domain/agreement";
import { areaCheck } from "@/lib/domain/area";
import { roundCents } from "@/lib/domain/money";
import { splitPayment } from "@/lib/domain/pricing";
import { DEFAULT_PARAMS, SERVICE_LABELS, type ServiceId } from "@/lib/domain/types";
import { driveMinutes } from "@/lib/domain/travel";
import { todayDetroit } from "@/lib/format";
import { geocodeAddress, measureLeg } from "@/lib/mileage";
import { newDocToken } from "@/lib/services/agreement";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

function fail(error: string): Err {
  return { ok: false, error };
}

export type OwnerJobInput = {
  /** The customer's account, found or created by the caller. */
  customer: UserRecord;
  service: ServiceId;
  /** Short title the customer sees, such as "Replace bathroom faucet". */
  scope: string;
  description: string;
  /** Blank means the work is at the customer's billing address. */
  jobSiteAddress: string;
  /** Hours on site each day. */
  hoursOnSite: number;
  /** Working days the job takes; the crew is reserved for the same window each day. */
  days: number;
  crewSize: number;
  /** The firm price, travel included. */
  total: number;
  /** The part of the total that is travel, if the owner wants it shown. */
  travel: number;
  /**
   * Set when the work is already finished: the calendar date it was done (YYYY-MM-DD).
   * The job then skips scheduling, starts at "balance due" for the whole price, and
   * goes out as an invoice. Blank or null means normal work to schedule.
   */
  doneOn?: string | null;
};

export const OWNER_JOB_LIMITS = { minHours: 0.5, maxHours: 12, maxDays: 30, maxCrew: 4, maxTotal: 50_000, maxDoneDaysAgo: 365 };

/** A calendar date for finished work: a real date, not in the future, not older than a year. */
export function checkDoneOn(value: string, today: string): { ok: true; date: string } | { ok: false; error: string } {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, error: "Enter the date the work was done." };
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return { ok: false, error: "That isn't a real date." };
  if (date > today) return { ok: false, error: "The date the work was done can't be in the future. For work still to do, leave it as work to schedule." };
  const [ty, tm, td] = today.split("-").map(Number);
  const ageDays = Math.round((Date.UTC(ty, tm - 1, td) - dt.getTime()) / 86_400_000);
  if (ageDays > OWNER_JOB_LIMITS.maxDoneDaysAgo) return { ok: false, error: "The date the work was done is more than a year ago. Check the year." };
  return { ok: true, date };
}

/**
 * A job that came in by phone or in person. The owner types the customer, the work,
 * and the price once; the app issues the invoice number and the contract link right away.
 * The price is the owner's and is never recomputed. Scheduling and payment then follow
 * the normal hold → pay → booked path. Work that is already done (`doneOn` set) skips
 * all of that: it starts at "balance due" for the whole price and goes out as an invoice.
 */
export async function createOwnerJob(repo: Repository, actor: Actor, input: OwnerJobInput): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can add a job this way.");
    let doneOn: string | null = null;
    if (input.doneOn && input.doneOn.trim()) {
      const checked = checkDoneOn(input.doneOn, todayDetroit());
      if (!checked.ok) return fail(checked.error);
      doneOn = checked.date;
    }
    const customer = input.customer;
    if (customer.role !== "customer") return fail("That email belongs to a worker or the owner, not a customer.");
    if (!customer.fullName.trim() || !customer.phone.trim()) return fail("The customer needs a name and a phone number.");
    if (!(input.service in SERVICE_LABELS)) return fail("Pick a service.");
    const scope = input.scope.replace(/\s+/g, " ").trim();
    if (scope.length < 3) return fail("Give the job a short title, such as 'Replace bathroom faucet'.");
    if (scope.length > 120) return fail("Keep the job title under 120 characters.");
    const description = input.description.trim() || scope;
    const total = roundCents(input.total);
    if (!Number.isFinite(total) || total <= 0) return fail("Enter the price as a dollar amount above zero.");
    if (total > OWNER_JOB_LIMITS.maxTotal) return fail(`Prices over $${OWNER_JOB_LIMITS.maxTotal.toLocaleString("en-US")} need a different agreement.`);
    const travel = roundCents(Number.isFinite(input.travel) ? Math.max(0, input.travel) : 0);
    if (travel > total) return fail("Travel can't be more than the whole price.");
    const hours = Number.isFinite(input.hoursOnSite) ? input.hoursOnSite : 2;
    if (hours < OWNER_JOB_LIMITS.minHours || hours > OWNER_JOB_LIMITS.maxHours) {
      return fail(`Hours on site must be between ${OWNER_JOB_LIMITS.minHours} and ${OWNER_JOB_LIMITS.maxHours}.`);
    }
    const days = Math.round(Number.isFinite(input.days) ? input.days : 1);
    if (days < 1 || days > OWNER_JOB_LIMITS.maxDays) return fail(`Days must be between 1 and ${OWNER_JOB_LIMITS.maxDays}.`);
    const crewSize = Math.round(Number.isFinite(input.crewSize) ? input.crewSize : 1);
    if (crewSize < 1 || crewSize > OWNER_JOB_LIMITS.maxCrew) return fail(`People on site must be between 1 and ${OWNER_JOB_LIMITS.maxCrew}.`);

    const differentSite = Boolean(input.jobSiteAddress.trim()) && input.jobSiteAddress.trim() !== customer.billingAddress.trim();
    const jobSiteAddress = differentSite ? input.jobSiteAddress.trim() : customer.billingAddress.trim();
    if (!jobSiteAddress) return fail("Add the job site address.");
    const zips = await repo.listZips();
    const area = areaCheck(differentSite ? jobSiteAddress : customer.billingZip || jobSiteAddress, zips);
    if (!area.found) return fail("Add a 5-digit ZIP to the job site address.");

    const settings = await repo.getSettings();
    let lat = area.lat;
    let lng = area.lng;
    const geocoded = await geocodeAddress(repo, jobSiteAddress);
    if (geocoded) {
      lat = geocoded.lat;
      lng = geocoded.lng;
    }
    const measured = await measureLeg(repo, settings, "shop", { address: jobSiteAddress, lat, lng, zipMiles: area.milesFromCadillac });
    // Finished work is due in full now; work to schedule follows the usual deposit rule.
    const split = doneOn
      ? { now: 0, later: total, rule: `Due in full. The work was done on ${longDate(doneOn)}.` }
      : splitPayment(total, settings.depositThreshold);
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: randomUUID(),
      customerId: customer.id,
      customerName: customer.fullName.trim(),
      customerEmail: customer.email,
      customerPhone: customer.phone.trim(),
      service: input.service,
      description,
      params: { ...DEFAULT_PARAMS, hours, helpers: crewSize },
      billingAddress: customer.billingAddress,
      jobSiteAddress,
      differentSite,
      jobZip: area.zip,
      county: area.county,
      city: area.city,
      // The owner took this job on the phone, so the address is already approved.
      areaAuto: true,
      areaLabel: area.inTable ? area.label : "Added by the owner",
      areaDetail: area.detail,
      jobLat: lat,
      jobLng: lng,
      zipMiles: area.milesFromCadillac,
      scope,
      lines: ownerPriceLines({ scope, total, travel }),
      assumptions: [],
      total,
      amountDueNow: split.now,
      balanceDue: split.later,
      payRule: split.rule,
      licenseLevel: "ok",
      licenseTrade: "Added by the owner",
      licenseWhy: "The owner took this job by phone or in person and typed the price.",
      licenseRule: "Owner's call",
      referralNote: "",
      urgent: false,
      pickup: false,
      photos: [],
      preferredWorkerId: null,
      crewId: null,
      workerIds: [],
      assignedBy: null,
      assignNote: "",
      scheduledDate: null,
      startMin: null,
      onsiteMinutes: Math.round(hours * 60),
      driveMinutes: driveMinutes(measured.miles, settings.driveFactor, settings.drivePadMinutes),
      reserveStartMin: null,
      reserveEndMin: null,
      travelMiles: measured.miles,
      travelFrom: measured.fromLabel,
      travelFee: travel,
      // Locked from the start: the price is the owner's and includes travel.
      travelLocked: true,
      travelSource: measured.source,
      // Finished work: nothing to schedule, the whole price is the balance due.
      status: doneOn ? "balance_due" : "quoted",
      priorStatus: null,
      holdUntil: null,
      invoiceNumber: null,
      paypalOrderId: null,
      completionNote: "",
      problemNote: "",
      priceChanges: [],
      ownerPriced: true,
      crewSize,
      durationDays: days,
      scheduledDates: [],
      docToken: newDocToken(),
      agreement: null,
      docSentAt: null,
      workDoneOn: doneOn,
      createdAt: now,
      updatedAt: now,
    };
    // Issue the invoice number now: this job is being written up for the customer today.
    const saved = await repo.saveJob(job, { issueInvoice: true, skipOverlap: true });
    return { ok: true, data: saved };
  });
}
