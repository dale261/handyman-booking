import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { mergeLibrary } from "@/lib/domain/library";
import { LIBRARY_SEED, type LibraryEntry } from "@/lib/domain/library-data";
import { normalizeSettings } from "@/lib/domain/settings";
import type { Settings, ZipRecord } from "@/lib/domain/types";
import type {
  CrewRecord,
  EmailRecord,
  JobRecord,
  LeadRecord,
  NotificationRecord,
  PaymentRecord,
  ReviewRecord,
  SaveJobOptions,
  UserRecord,
  WorkerRecord,
} from "@/lib/db/types";
import { SlotTakenError } from "@/lib/db/types";
import type { AiReservation, AiUsageRow, RateLimitResult, Repository } from "@/lib/db/repository";

type ProfileRow = {
  id: string;
  role: UserRecord["role"];
  email: string;
  full_name: string;
  phone: string;
  billing_address: string;
  billing_zip: string;
};

export class SupabaseRepository implements Repository {
  readonly mode = "supabase" as const;
  private zipCache: ZipRecord[] | null = null;
  private client: SupabaseClient | null = null;

  private db(): SupabaseClient {
    if (!this.client) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error("Supabase URL and service role key are required.");
      this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    }
    return this.client;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  private async must<T>(promise: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>): Promise<T> {
    const { data, error } = await promise;
    if (error) {
      if (/exclusion|23P01|conflicting key|overlap/i.test(error.message)) throw new SlotTakenError();
      throw new Error(error.message);
    }
    return data;
  }

  async getSettings() {
    const data = await this.must(
      this.db().from("app_settings").select("data, owner_email").eq("id", 1).single(),
    );
    if (!data) throw new Error("Settings row is missing. Run the database setup SQL.");
    const settings = normalizeSettings(data.data as Partial<Settings>);
    if (!settings.ownerNotifyEmail && data.owner_email) settings.ownerNotifyEmail = data.owner_email;
    return settings;
  }

  async listLibrary() {
    try {
      const data = await this.must(this.db().from("cost_library").select("*").order("sort_order"));
      const rows = (data as Record<string, unknown>[]).map(libraryFromRow);
      return mergeLibrary(rows);
    } catch (error) {
      console.warn("[library] cost_library is unavailable, using the built-in seed", error);
      return LIBRARY_SEED.map((entry) => ({ ...entry, keywords: [...entry.keywords], suppressIds: [...entry.suppressIds] }));
    }
  }

  async saveLibrary(entries: LibraryEntry[]) {
    const next = mergeLibrary(entries);
    await this.must(
      this.db().from("cost_library").upsert(
        next.map((entry) => ({
          id: entry.id,
          name: entry.name,
          group_key: entry.group,
          unit: entry.unit,
          national_low: entry.nationalLow,
          national_high: entry.nationalHigh,
          local_low: entry.localLow,
          local_high: entry.localHigh,
          source: entry.source,
          notes: entry.notes,
          keywords: entry.keywords,
          performs: entry.performs,
          sort_order: entry.sortOrder,
        })),
      ),
    );
  }

  async saveSettings(settings: Settings) {
    const next = normalizeSettings(settings);
    await this.must(
      this.db()
        .from("app_settings")
        .update({ data: next, owner_email: next.ownerNotifyEmail })
        .eq("id", 1),
    );
  }

  async listZips() {
    if (this.zipCache) return this.zipCache;
    const data = await this.must(this.db().from("service_area_zips").select("*").order("zip"));
    this.zipCache = (data as Record<string, unknown>[]).map((row) => ({
      zip: String(row.zip),
      city: String(row.city ?? ""),
      county: String(row.county ?? ""),
      countiesSpanned: Array.isArray(row.counties_spanned) ? (row.counties_spanned as string[]) : [],
      status: row.status === "auto_book" ? "auto_book" : "owner_review",
      flagReason: String(row.flag_reason ?? ""),
      countyNote: String(row.county_note ?? ""),
      milesFromCadillac: row.miles_from_cadillac == null ? null : Number(row.miles_from_cadillac),
      lat: row.lat == null ? null : Number(row.lat),
      lng: row.lng == null ? null : Number(row.lng),
      source: String(row.source ?? ""),
    }));
    return this.zipCache;
  }

  async listCrews() {
    const data = await this.must(this.db().from("crews").select("*").order("name"));
    return (data as { id: string; name: string; active: boolean }[]).map((row) => ({
      id: row.id,
      name: row.name,
      active: row.active,
    }));
  }

  async saveCrew(crew: CrewRecord) {
    await this.must(this.db().from("crews").upsert({ id: crew.id, name: crew.name, active: crew.active }));
  }

  async deleteCrew(id: string) {
    await this.must(this.db().from("workers").update({ crew_id: null }).eq("crew_id", id));
    await this.must(this.db().from("crews").delete().eq("id", id));
  }

  async listWorkers() {
    const data = await this.must(this.db().from("workers").select("*").order("full_name"));
    return (data as Record<string, unknown>[]).map(workerFromRow);
  }

  async saveWorker(worker: WorkerRecord) {
    await this.must(
      this.db().from("workers").upsert({
        id: worker.id,
        profile_id: worker.profileId,
        full_name: worker.fullName,
        email: worker.email,
        crew_id: worker.crewId,
        day_start_min: worker.dayStartMin,
        day_end_min: worker.dayEndMin,
        work_days: worker.workDays,
        active: worker.active,
      }),
    );
  }

  async deleteWorker(id: string) {
    await this.must(this.db().from("workers").delete().eq("id", id));
  }

  async listTimeOff() {
    const data = await this.must(this.db().from("time_off").select("*"));
    return (data as { id: string; worker_id: string; off_date: string }[]).map((row) => ({
      id: row.id,
      workerId: row.worker_id,
      date: String(row.off_date).slice(0, 10),
    }));
  }

  async addTimeOff(workerId: string, date: string) {
    await this.must(this.db().from("time_off").upsert({ worker_id: workerId, off_date: date }, { onConflict: "worker_id,off_date" }));
  }

  async removeTimeOff(id: string) {
    await this.must(this.db().from("time_off").delete().eq("id", id));
  }

  async listJobs() {
    const data = await this.must(this.db().from("jobs").select("payload").order("created_at", { ascending: false }));
    return (data as { payload: JobRecord }[]).map((row) => row.payload);
  }

  async getJob(id: string) {
    const { data, error } = await this.db().from("jobs").select("payload").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return (data?.payload as JobRecord) ?? null;
  }

  async saveJob(job: JobRecord, opts?: SaveJobOptions) {
    const data = await this.must(
      this.db().rpc("save_job", { p_job: job, p_issue: Boolean(opts?.issueInvoice && job.invoiceNumber == null) }),
    );
    return data as JobRecord;
  }

  async listPayments(jobId?: string) {
    let query = this.db().from("payments").select("*").order("created_at");
    if (jobId) query = query.eq("job_id", jobId);
    const data = await this.must(query);
    return (data as Record<string, unknown>[]).map(paymentFromRow);
  }

  async savePayment(payment: PaymentRecord) {
    await this.must(
      this.db().from("payments").upsert({
        id: payment.id,
        job_id: payment.jobId,
        kind: payment.kind,
        amount: payment.amount,
        method: payment.method,
        status: payment.status,
        closed: payment.closed,
        note: payment.note,
        paypal_capture_id: payment.paypalCaptureId,
        created_at: payment.createdAt,
      }),
    );
  }

  async listNotifications() {
    const data = await this.must(this.db().from("notifications").select("*").order("created_at", { ascending: false }));
    return (data as Record<string, unknown>[]).map(noteFromRow);
  }

  async addNotification(note: NotificationRecord) {
    await this.must(
      this.db().from("notifications").insert({
        id: note.id,
        kind: note.kind,
        title: note.title,
        detail: note.detail,
        read: note.read,
        job_id: note.jobId,
        created_at: note.createdAt,
      }),
    );
  }

  async markNotificationsRead() {
    await this.must(this.db().from("notifications").update({ read: true }).eq("read", false));
  }

  async listEmails() {
    const data = await this.must(this.db().from("emails").select("*").order("created_at", { ascending: false }));
    return (data as Record<string, unknown>[]).map(emailFromRow);
  }

  async addEmail(email: EmailRecord) {
    console.info(`\n[email] To: ${email.to}\nSubject: ${email.subject}\n${email.body}\n`);
    await this.must(
      this.db().from("emails").insert({
        id: email.id,
        recipient: email.to,
        subject: email.subject,
        body: email.body,
        job_id: email.jobId,
        sent: email.sent,
        created_at: email.createdAt,
      }),
    );
  }

  async markEmailSent(id: string) {
    await this.must(this.db().from("emails").update({ sent: true }).eq("id", id));
  }

  async listUsers() {
    const [profiles, workers] = await Promise.all([
      this.must(this.db().from("profiles").select("*").order("full_name")),
      this.listWorkers(),
    ]);
    return (profiles as ProfileRow[]).map((row) => profileToUser(row, workers.find((worker) => worker.profileId === row.id)?.id ?? null));
  }

  async getUser(id: string) {
    const { data, error } = await this.db().from("profiles").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const workers = await this.listWorkers();
    return profileToUser(data as ProfileRow, workers.find((worker) => worker.profileId === id)?.id ?? null);
  }

  async getUserByEmail(email: string) {
    const { data, error } = await this.db().from("profiles").select("*").ilike("email", email).maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const workers = await this.listWorkers();
    return profileToUser(data as ProfileRow, workers.find((worker) => worker.profileId === data.id)?.id ?? null);
  }

  async saveUser(user: UserRecord) {
    await this.must(
      this.db().from("profiles").upsert({
        id: user.id,
        role: user.role,
        email: user.email,
        full_name: user.fullName,
        phone: user.phone,
        billing_address: user.billingAddress,
        billing_zip: user.billingZip,
      }),
    );
    if (user.workerId) {
      await this.must(this.db().from("workers").update({ profile_id: user.id }).eq("id", user.workerId));
    }
  }

  async listLeads() {
    const data = await this.must(this.db().from("leads").select("*").order("created_at", { ascending: false }));
    return (data as Record<string, unknown>[]).map(leadFromRow);
  }

  async getLead(id: string) {
    const { data, error } = await this.db().from("leads").select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? leadFromRow(data as Record<string, unknown>) : null;
  }

  async saveLead(lead: LeadRecord) {
    await this.must(
      this.db().from("leads").upsert({
        id: lead.id,
        full_name: lead.fullName,
        phone: lead.phone,
        email: lead.email,
        service: lead.service,
        address: lead.address,
        zip: lead.zip,
        description: lead.description,
        total: lead.total,
        review: lead.review,
        job_id: lead.jobId,
        created_at: lead.createdAt,
        updated_at: lead.updatedAt,
      }),
    );
  }

  async listReviews() {
    const data = await this.must(this.db().from("reviews").select("*").order("created_at", { ascending: false }));
    return (data as Record<string, unknown>[]).map(reviewFromRow);
  }

  async getReview(jobId: string) {
    const { data, error } = await this.db().from("reviews").select("*").eq("job_id", jobId).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? reviewFromRow(data as Record<string, unknown>) : null;
  }

  async saveReview(review: ReviewRecord) {
    await this.must(
      this.db().from("reviews").upsert({
        job_id: review.jobId,
        customer_id: review.customerId,
        customer_name: review.customerName,
        rating: review.rating,
        comment: review.comment,
        publish_photos: review.publishPhotos,
        created_at: review.createdAt,
      }),
    );
  }

  async getGeo(key: string) {
    const { data, error } = await this.db().from("geo_cache").select("lat, lng").eq("address_key", key).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { lat: Number(data.lat), lng: Number(data.lng) } : null;
  }

  async saveGeo(key: string, point: { lat: number; lng: number }) {
    await this.must(this.db().from("geo_cache").upsert({ address_key: key, lat: point.lat, lng: point.lng }));
  }

  async getRoute(key: string) {
    const { data, error } = await this.db().from("route_cache").select("miles, source").eq("route_key", key).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { miles: Number(data.miles), source: String(data.source) } : null;
  }

  async saveRoute(key: string, miles: number, source: string) {
    await this.must(this.db().from("route_cache").upsert({ route_key: key, miles, source }));
  }

  async reserveAiCall(customerId: string, day: string): Promise<AiReservation> {
    const settings = await this.getSettings();
    try {
      const data = await this.must(
        this.db().rpc("reserve_ai_call", {
          p_customer: customerId,
          p_day: day,
          p_daily_cap: settings.aiDailyCap,
          p_customer_cap: settings.aiCustomerDailyCap,
        }),
      );
      return reservationFromRpc(data, settings.aiDailyCap, settings.aiCustomerDailyCap);
    } catch (error) {
      console.error("[ai] reserve_ai_call failed, treating the day as capped", error);
      return {
        allowed: false,
        total: 0,
        customerCalls: 0,
        dailyCap: settings.aiDailyCap,
        customerCap: settings.aiCustomerDailyCap,
      };
    }
  }

  async aiUsageForDay(day: string): Promise<AiUsageRow[]> {
    try {
      const data = await this.must(
        this.db().from("ai_usage").select("usage_date, customer_id, calls").eq("usage_date", day),
      );
      return (data as { usage_date: string; customer_id: string; calls: number }[]).map((row) => ({
        usageDate: String(row.usage_date).slice(0, 10),
        customerId: row.customer_id,
        calls: Number(row.calls),
      }));
    } catch (error) {
      console.warn("[ai] usage table unavailable", error);
      return [];
    }
  }

  async hitRateLimit(bucket: string, ip: string, max: number, windowMs: number): Promise<RateLimitResult> {
    const data = await this.must(
      this.db().rpc("hit_ip_limit", {
        p_bucket: bucket,
        p_ip: ip,
        p_max: max,
        p_window_ms: windowMs,
      }),
    );
    const row = (data ?? {}) as { allowed?: boolean; hits?: number };
    return { allowed: Boolean(row.allowed), hits: Number(row.hits ?? 0) };
  }
}

function reservationFromRpc(data: unknown, dailyCap: number, customerCap: number): AiReservation {
  const row = (data ?? {}) as {
    allowed?: boolean;
    total?: number;
    customerCalls?: number;
    dailyCap?: number;
    customerCap?: number;
  };
  return {
    allowed: Boolean(row.allowed),
    total: Number(row.total ?? 0),
    customerCalls: Number(row.customerCalls ?? 0),
    dailyCap: Number(row.dailyCap ?? dailyCap),
    customerCap: Number(row.customerCap ?? customerCap),
  };
}

function libraryFromRow(row: Record<string, unknown>): LibraryEntry {
  const numOrNull = (value: unknown) => (value == null || value === "" ? null : Number(value));
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    group: row.group_key === "trades" || row.group_key === "build" ? row.group_key : "handy",
    unit: String(row.unit ?? ""),
    nationalLow: numOrNull(row.national_low),
    nationalHigh: numOrNull(row.national_high),
    localLow: numOrNull(row.local_low),
    localHigh: numOrNull(row.local_high),
    source: String(row.source ?? ""),
    notes: String(row.notes ?? ""),
    keywords: Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
    performs: Boolean(row.performs),
    sortOrder: Number(row.sort_order ?? 0),
    suppressIds: [],
  };
}

function profileToUser(row: ProfileRow, workerId: string | null): UserRecord {
  return {
    id: row.id,
    role: row.role,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    billingAddress: row.billing_address,
    billingZip: row.billing_zip,
    passwordHash: null,
    workerId,
  };
}

function workerFromRow(row: Record<string, unknown>): WorkerRecord {
  return {
    id: String(row.id),
    profileId: row.profile_id ? String(row.profile_id) : null,
    fullName: String(row.full_name),
    email: String(row.email),
    crewId: row.crew_id ? String(row.crew_id) : null,
    dayStartMin: Number(row.day_start_min),
    dayEndMin: Number(row.day_end_min),
    workDays: Array.isArray(row.work_days) ? (row.work_days as number[]) : [1, 2, 3, 4, 5, 6],
    active: Boolean(row.active),
  };
}

function paymentFromRow(row: Record<string, unknown>): PaymentRecord {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    kind: row.kind as PaymentRecord["kind"],
    amount: Number(row.amount),
    method: row.method as PaymentRecord["method"],
    status: row.status as PaymentRecord["status"],
    closed: Boolean(row.closed),
    note: String(row.note ?? ""),
    paypalCaptureId: row.paypal_capture_id ? String(row.paypal_capture_id) : null,
    createdAt: String(row.created_at),
  };
}

function noteFromRow(row: Record<string, unknown>): NotificationRecord {
  return {
    id: String(row.id),
    kind: row.kind as NotificationRecord["kind"],
    title: String(row.title),
    detail: String(row.detail),
    read: Boolean(row.read),
    jobId: row.job_id ? String(row.job_id) : null,
    createdAt: String(row.created_at),
  };
}

function emailFromRow(row: Record<string, unknown>): EmailRecord {
  return {
    id: String(row.id),
    to: String(row.recipient),
    subject: String(row.subject),
    body: String(row.body),
    jobId: row.job_id ? String(row.job_id) : null,
    sent: Boolean(row.sent),
    createdAt: String(row.created_at),
  };
}

function leadFromRow(row: Record<string, unknown>): LeadRecord {
  return {
    id: String(row.id),
    fullName: String(row.full_name ?? ""),
    phone: String(row.phone ?? ""),
    email: String(row.email ?? ""),
    service: row.service as LeadRecord["service"],
    address: String(row.address ?? ""),
    zip: String(row.zip ?? ""),
    description: String(row.description ?? ""),
    total: row.total == null ? null : Number(row.total),
    review: Boolean(row.review),
    jobId: row.job_id ? String(row.job_id) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at),
  };
}

function reviewFromRow(row: Record<string, unknown>): ReviewRecord {
  return {
    jobId: String(row.job_id),
    customerId: String(row.customer_id),
    customerName: String(row.customer_name ?? ""),
    rating: Number(row.rating),
    comment: String(row.comment ?? ""),
    publishPhotos: Boolean(row.publish_photos),
    createdAt: String(row.created_at),
  };
}
