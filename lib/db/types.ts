import type { QuoteMeta } from "@/lib/domain/library";
import type { QuoteLine, QuoteParams, ScreenLevel, ServiceId } from "@/lib/domain/types";

export type Role = "customer" | "worker" | "owner";

export type JobStatus =
  | "quoted"
  | "scope_review"
  | "referred"
  | "pending_area"
  | "declined"
  | "held"
  | "released"
  | "booked"
  | "price_change"
  | "in_progress"
  | "awaiting_approval"
  | "disputed"
  | "balance_due"
  | "completed"
  | "reviewed"
  | "cancel_requested"
  | "cancelled";

export type UserRecord = {
  id: string;
  role: Role;
  email: string;
  fullName: string;
  phone: string;
  billingAddress: string;
  billingZip: string;
  passwordHash: string | null;
  workerId: string | null;
};

export type Actor = {
  id: string;
  role: Role;
  email: string;
  fullName: string;
  phone: string;
  workerId: string | null;
};

export function actorFromUser(user: UserRecord): Actor {
  return {
    id: user.id,
    role: user.role,
    email: user.email,
    fullName: user.fullName,
    phone: user.phone,
    workerId: user.workerId,
  };
}

export type CrewRecord = {
  id: string;
  name: string;
  active: boolean;
};

export type WorkerRecord = {
  id: string;
  profileId: string | null;
  fullName: string;
  email: string;
  crewId: string | null;
  dayStartMin: number;
  dayEndMin: number;
  workDays: number[];
  active: boolean;
};

export type TimeOffRecord = {
  id: string;
  workerId: string;
  date: string;
};

export type PhotoRef = { id: string; name: string };

export type PriceChangeOutcome = "pending" | "approved" | "declined" | "cancel_on_site";

export type PriceChange = {
  at: string;
  reason: string;
  previousTotal: number;
  proposedTotal: number;
  outcome: PriceChangeOutcome;
};

/** The customer's acceptance of the written agreement, typed on the contract page. */
export type Agreement = {
  signedName: string;
  signedAt: string;
  /** The total they agreed to. The invoice shows a note if the price changed later. */
  total: number;
  ip: string;
  userAgent: string;
};

export type JobRecord = {
  id: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  service: ServiceId;
  description: string;
  params: QuoteParams;
  billingAddress: string;
  jobSiteAddress: string;
  differentSite: boolean;
  jobZip: string;
  county: string;
  city: string;
  areaAuto: boolean;
  areaLabel: string;
  areaDetail: string;
  jobLat: number | null;
  jobLng: number | null;
  zipMiles: number | null;
  scope: string;
  lines: QuoteLine[];
  assumptions: string[];
  total: number;
  amountDueNow: number;
  balanceDue: number;
  payRule: string;
  licenseLevel: ScreenLevel;
  licenseTrade: string;
  licenseWhy: string;
  licenseRule: string;
  referralNote: string;
  urgent: boolean;
  pickup: boolean;
  photos: PhotoRef[];
  preferredWorkerId: string | null;
  crewId: string | null;
  workerIds: string[];
  assignedBy: "auto" | "owner" | null;
  assignNote: string;
  scheduledDate: string | null;
  startMin: number | null;
  onsiteMinutes: number;
  driveMinutes: number;
  reserveStartMin: number | null;
  reserveEndMin: number | null;
  travelMiles: number | null;
  travelFrom: string;
  travelFee: number;
  travelLocked: boolean;
  travelSource: string;
  status: JobStatus;
  priorStatus: JobStatus | null;
  holdUntil: string | null;
  invoiceNumber: number | null;
  paypalOrderId: string | null;
  completionNote: string;
  problemNote: string;
  /** Set for unlisted library quotes. Rate-sheet jobs leave this empty. */
  quoteMeta?: QuoteMeta | null;
  /** On-site price changes. Missing on jobs saved before this field existed. */
  priceChanges?: PriceChange[];
  /** True when the owner typed the price for a phone or in-person job. The app never recomputes it. */
  ownerPriced?: boolean;
  /** People the owner wants on site for an owner-entered job. Listed services compute their own. */
  crewSize?: number | null;
  /** Secret in the no-sign-in contract link. Missing on jobs saved before this field existed. */
  docToken?: string;
  /** Set when the customer signs the agreement online. */
  agreement?: Agreement | null;
  /** When the owner last emailed the contract and invoice link. */
  docSentAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PaymentRecord = {
  id: string;
  jobId: string;
  kind: "deposit" | "full" | "balance" | "refund";
  amount: number;
  method: "paypal" | "cash" | "check";
  status: "pending" | "paid" | "sent";
  closed: boolean;
  note: string;
  paypalCaptureId: string | null;
  createdAt: string;
};

export type NotificationRecord = {
  id: string;
  kind: "pay" | "approval" | "refund" | "done" | "lead" | "signed";
  title: string;
  detail: string;
  read: boolean;
  jobId: string | null;
  createdAt: string;
};

export type EmailRecord = {
  id: string;
  to: string;
  subject: string;
  body: string;
  jobId: string | null;
  sent: boolean;
  createdAt: string;
};

/** Someone who gave a name and phone to see a price. jobId is set once they book. */
export type LeadRecord = {
  id: string;
  fullName: string;
  phone: string;
  email: string;
  service: ServiceId;
  address: string;
  zip: string;
  description: string;
  /** The price they saw, or null when Dale had to look first. */
  total: number | null;
  review: boolean;
  jobId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ReviewRecord = {
  jobId: string;
  customerId: string;
  customerName: string;
  rating: number;
  comment: string;
  publishPhotos: boolean;
  createdAt: string;
};

export type SaveJobOptions = {
  issueInvoice?: boolean;
  skipOverlap?: boolean;
};

export class SlotTakenError extends Error {
  constructor() {
    super("That time was just taken. Pick another.");
    this.name = "SlotTakenError";
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };
