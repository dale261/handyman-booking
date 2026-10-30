import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { Actor, JobRecord, UserRecord } from "@/lib/db/types";
import { ownerPriceLines } from "@/lib/domain/agreement";
import { areaCheck } from "@/lib/domain/area";
import { roundCents } from "@/lib/domain/money";
import { splitPayment } from "@/lib/domain/pricing";
import { DEFAULT_PARAMS, SERVICE_LABELS, type ServiceId } from "@/lib/domain/types";
import { driveMinutes } from "@/lib/domain/travel";
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
  hoursOnSite: number;
  crewSize: number;
  /** The firm price, travel included. */
  total: number;
  /** The part of the total that is travel, if the owner wants it shown. */
  travel: number;
};

export const OWNER_JOB_LIMITS = { minHours: 0.5, maxHours: 12, maxCrew: 4, maxTotal: 50_000 };

/**
 * A job that came in by phone or in person. The owner types the customer, the work,
 * and the price once; the app issues the invoice number and the contract link right away.
 * The price is the owner's and is never recomputed. Scheduling and payment then follow
 * the normal hold → pay → booked path.
 */
export async function createOwnerJob(repo: Repository, actor: Actor, input: OwnerJobInput): Promise<Ok<JobRecord> | Err> {
  return repo.run(async () => {
    if (actor.role !== "owner") return fail("Only the owner can add a job this way.");
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
    const split = splitPayment(total, settings.depositThreshold);
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
      status: "quoted",
      priorStatus: null,
      holdUntil: null,
      invoiceNumber: null,
      paypalOrderId: null,
      completionNote: "",
      problemNote: "",
      priceChanges: [],
      ownerPriced: true,
      crewSize,
      docToken: newDocToken(),
      agreement: null,
      docSentAt: null,
      createdAt: now,
      updatedAt: now,
    };
    // Issue the invoice number now: this job is being written up for the customer today.
    const saved = await repo.saveJob(job, { issueInvoice: true, skipOverlap: true });
    return { ok: true, data: saved };
  });
}
