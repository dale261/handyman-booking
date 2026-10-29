import { randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import type { LeadRecord } from "@/lib/db/types";
import { areaCheck } from "@/lib/domain/area";
import { jobSiteAddress, phoneDigits, type QuoteDraft } from "@/lib/domain/draft";
import { licenseEstimate, quoteCalc, splitPayment } from "@/lib/domain/pricing";
import { classify } from "@/lib/domain/screening";
import { SERVICE_LABELS, type QuoteLine } from "@/lib/domain/types";
import { usd } from "@/lib/format";
import { geocodeAddress, measureLeg } from "@/lib/mileage";
import { notify } from "@/lib/services/booking";

/** What a visitor sees before creating an account. Never a range, never a price under review. */
export type PublicEstimate = {
  scope: string;
  lines: QuoteLine[];
  assumptions: string[];
  total: number;
  dueNow: number;
  balance: number;
  payRule: string;
  area: {
    /** The ZIP is in the service-area table. */
    known: boolean;
    /** Bookable without Dale checking the address first. */
    auto: boolean;
    label: string;
    detail: string;
    city: string;
    county: string;
  };
  /** Dale looks at it before any price is shown. lines and total are empty when this is true. */
  review: boolean;
  reviewNote: string;
};

export const PUBLIC_REVIEW_NOTE =
  "We need to take a look at this one before it can be booked. Create an account and we'll send you one firm price, usually within 1 business day. Nothing is booked or paid until you approve it.";

type Ok<T> = { ok: true; data: T };
type Err = { ok: false; error: string };

/**
 * Price a listed service from its answers and the job address, with no account.
 * Same rate sheet, the same address lookup, and the same travel math as the
 * real quote, so the number here is the number on the job page.
 * No AI call is made here, so anonymous visitors cost nothing.
 */
export async function publicEstimate(repo: Repository, draft: QuoteDraft): Promise<Ok<PublicEstimate> | Err> {
  return repo.run(async () => {
    const zips = await repo.listZips();
    const area = areaCheck(draft.zip, zips);
    if (!area.found) return { ok: false, error: "Enter the 5-digit ZIP where the work is." };
    const settings = await repo.getSettings();

    const site = jobSiteAddress(draft);
    let lat = area.lat;
    let lng = area.lng;
    const geocoded = await geocodeAddress(repo, site);
    if (geocoded) {
      lat = geocoded.lat;
      lng = geocoded.lng;
    }
    let miles: number | null = null;
    let estimate = true;
    if (lat != null || area.milesFromCadillac != null) {
      const measured = await measureLeg(repo, settings, "shop", {
        address: site,
        lat,
        lng,
        zipMiles: area.milesFromCadillac,
      });
      miles = measured.miles;
      estimate = measured.source !== "openrouteservice" && measured.source !== "osrm";
    }

    const quote = quoteCalc(draft.service, draft.params, settings, area.county, miles, {
      urgent: draft.urgent,
      pickup: draft.pickup,
      travelFrom: "the shop",
      milesAreEstimate: estimate,
    });
    const flag = classify(draft.service, draft.description, draft.params, licenseEstimate(quote), settings);
    const review = flag.level !== "ok";
    const split = splitPayment(quote.total, settings.depositThreshold);

    const assumptions = [...quote.assumptions];
    if (miles != null) {
      assumptions.push(
        "Travel is measured from our shop to this address. When you pick a time, the drive is measured from wherever the crew is coming from that day, and the total you see on that time is the one you pay.",
      );
    }

    const areaInfo = {
      known: area.inTable,
      auto: area.auto,
      label: area.label,
      detail: area.detail,
      city: area.city,
      county: area.county,
    };

    if (review) {
      return {
        ok: true,
        data: {
          scope: quote.scope,
          lines: [],
          assumptions: [],
          total: 0,
          dueNow: 0,
          balance: 0,
          payRule: "",
          area: areaInfo,
          review: true,
          reviewNote: PUBLIC_REVIEW_NOTE,
        },
      };
    }

    return {
      ok: true,
      data: {
        scope: quote.scope,
        lines: quote.lines,
        assumptions,
        total: quote.total,
        dueNow: split.now,
        balance: split.later,
        payRule: split.rule,
        area: areaInfo,
        review: false,
        reviewNote: "",
      },
    };
  });
}

/** A second price check from the same phone within this window updates the lead instead of adding one. */
const SAME_LEAD_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Save who asked for the price. The first check from a phone number tells
 * Dale (Queue notice plus email); later checks within a day update that lead.
 * Returns the lead so its id can ride along to sign-up.
 */
/** The open lead for this phone from the last day, if there is one. */
export async function recentLeadForPhone(repo: Repository, phone: string, now = new Date()): Promise<LeadRecord | null> {
  const digits = phoneDigits(phone);
  const found = (await repo.listLeads()).find(
    (lead) =>
      lead.jobId == null &&
      phoneDigits(lead.phone) === digits &&
      now.getTime() - new Date(lead.createdAt).getTime() < SAME_LEAD_WINDOW_MS,
  );
  return found ?? null;
}

export async function recordLead(repo: Repository, draft: QuoteDraft, estimate: PublicEstimate): Promise<LeadRecord> {
  return repo.run(async () => {
    const now = new Date();
    const existing = await recentLeadForPhone(repo, draft.phone, now);
    const lead: LeadRecord = {
      id: existing?.id ?? randomUUID(),
      fullName: draft.fullName,
      phone: draft.phone,
      email: draft.email,
      service: draft.service,
      address: jobSiteAddress(draft),
      zip: draft.zip,
      description: draft.description,
      total: estimate.review ? null : estimate.total,
      review: estimate.review,
      jobId: existing?.jobId ?? null,
      createdAt: existing?.createdAt ?? now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await repo.saveLead(lead);
    if (!existing) {
      const settings = await repo.getSettings();
      const place = estimate.area.known ? `${estimate.area.city} ${draft.zip}` : `ZIP ${draft.zip}`;
      const saw = estimate.review ? "Needs your look before a price is shown." : `Saw ${usd(estimate.total)}.`;
      await notify(
        repo,
        settings,
        "lead",
        `New lead: ${draft.fullName}, ${SERVICE_LABELS[draft.service]} in ${place}`,
        `${draft.phone}${draft.email ? ` · ${draft.email}` : ""}. ${lead.address}. ${saw} "${draft.description}" Leads are under Leads in the owner menu.`,
        null,
      );
    }
    return lead;
  });
}
