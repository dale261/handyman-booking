import type { LibraryEntry } from "@/lib/domain/library-data";
import type { Settings, ZipRecord } from "@/lib/domain/types";
import type {
  CrewRecord,
  EmailRecord,
  JobRecord,
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
  listReviews(): Promise<ReviewRecord[]>;
  getReview(jobId: string): Promise<ReviewRecord | null>;
  saveReview(review: ReviewRecord): Promise<void>;
  getGeo(key: string): Promise<{ lat: number; lng: number } | null>;
  saveGeo(key: string, point: { lat: number; lng: number }): Promise<void>;
  getRoute(key: string): Promise<{ miles: number; source: string } | null>;
  saveRoute(key: string, miles: number, source: string): Promise<void>;
}
