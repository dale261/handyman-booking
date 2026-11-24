import type { LibraryEntry } from "@/lib/domain/library-data";
import type { Settings, ZipRecord } from "@/lib/domain/types";
import type {
  CrewEntry,
  CrewRate,
  CrewRecord,
  PayItem,
  EmailRecord,
  JobRecord,
  LeadRecord,
  NotificationRecord,
  PaymentRecord,
  ReviewRecord,
  SaveJobOptions,
  TimeOffRecord,
  UserRecord,
  WorkerRecord,
} from "@/lib/db/types";

export interface Repository {
  readonly mode: "local" | "supabase";
  run<T>(fn: () => Promise<T>): Promise<T>;
  getSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  listLibrary(): Promise<LibraryEntry[]>;
  saveLibrary(entries: LibraryEntry[]): Promise<void>;
  listZips(): Promise<ZipRecord[]>;
  listCrews(): Promise<CrewRecord[]>;
  saveCrew(crew: CrewRecord): Promise<void>;
  deleteCrew(id: string): Promise<void>;
  listWorkers(): Promise<WorkerRecord[]>;
  saveWorker(worker: WorkerRecord): Promise<void>;
  deleteWorker(id: string): Promise<void>;
  listTimeOff(): Promise<TimeOffRecord[]>;
  addTimeOff(workerId: string, date: string): Promise<void>;
  removeTimeOff(id: string): Promise<void>;
  listJobs(): Promise<JobRecord[]>;
  getJob(id: string): Promise<JobRecord | null>;
  saveJob(job: JobRecord, opts?: SaveJobOptions): Promise<JobRecord>;
  listPayments(jobId?: string): Promise<PaymentRecord[]>;
  savePayment(payment: PaymentRecord): Promise<void>;
  listNotifications(): Promise<NotificationRecord[]>;
  addNotification(note: NotificationRecord): Promise<void>;
  markNotificationsRead(): Promise<void>;
  listEmails(): Promise<EmailRecord[]>;
  addEmail(email: EmailRecord): Promise<void>;
  markEmailSent(id: string): Promise<void>;
  listUsers(): Promise<UserRecord[]>;
  getUser(id: string): Promise<UserRecord | null>;
  getUserByEmail(email: string): Promise<UserRecord | null>;
  saveUser(user: UserRecord): Promise<void>;
  listLeads(): Promise<LeadRecord[]>;
  getLead(id: string): Promise<LeadRecord | null>;
  saveLead(lead: LeadRecord): Promise<void>;
  /** False until the crew log's table exists. Lets the owner's pages say the setup step is still to do. */
  crewLogReady(): Promise<boolean>;
  /** The crew log: shop time and receipts to reimburse. Newest day first. */
  listCrewEntries(): Promise<CrewEntry[]>;
  getCrewEntry(id: string): Promise<CrewEntry | null>;
  saveCrewEntry(entry: CrewEntry): Promise<void>;
  deleteCrewEntry(id: string): Promise<void>;
  /** False until the crew pay table exists. Lets the owner's Pay page say the setup step is still to do. */
  payReady(): Promise<boolean>;
  /** Crew pay: what each person earned and what they have been paid. Owner only. Newest day first. */
  listPay(): Promise<PayItem[]>;
  getPayItem(id: string): Promise<PayItem | null>;
  savePayItem(item: PayItem): Promise<void>;
  deletePayItem(id: string): Promise<void>;
  /** Many at once, for loading the owner's records file: one trip to the database, not one per line. */
  savePayItems(items: PayItem[]): Promise<void>;
  deletePayItems(ids: string[]): Promise<void>;
  /** False until the crew rates table exists. Until then there is no rate list and every rate is set by hand. */
  ratesReady(): Promise<boolean>;
  /** The owner's rate list. Owner only. Empty when the table isn't there yet. */
  listRates(): Promise<CrewRate[]>;
  saveRate(rate: CrewRate): Promise<void>;
  deleteRate(id: string): Promise<void>;
  listReviews(): Promise<ReviewRecord[]>;
  getReview(jobId: string): Promise<ReviewRecord | null>;
  saveReview(review: ReviewRecord): Promise<void>;
  getGeo(key: string): Promise<{ lat: number; lng: number } | null>;
  saveGeo(key: string, point: { lat: number; lng: number }): Promise<void>;
  getRoute(key: string): Promise<{ miles: number; source: string } | null>;
  saveRoute(key: string, miles: number, source: string): Promise<void>;
  /** Count one model call for this customer on this Detroit date, or refuse when a cap is already used. */
  reserveAiCall(customerId: string, day: string): Promise<AiReservation>;
  aiUsageForDay(day: string): Promise<AiUsageRow[]>;
  /** True in `allowed` until this IP reaches max hits inside the window. */
  hitRateLimit(bucket: string, ip: string, max: number, windowMs: number): Promise<RateLimitResult>;
}

export type AiUsageRow = {
  usageDate: string;
  customerId: string;
  calls: number;
};

export type AiReservation = {
  allowed: boolean;
  total: number;
  customerCalls: number;
  dailyCap: number;
  customerCap: number;
};

export type RateLimitResult = {
  allowed: boolean;
  hits: number;
};
