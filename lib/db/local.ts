import { AsyncLocalStorage } from "node:async_hooks";
import fs from "node:fs";
import path from "node:path";
import { mergeLibrary } from "@/lib/domain/library";
import type { LibraryEntry } from "@/lib/domain/library-data";
import { blocksSchedule } from "@/lib/domain/scheduling";
import { normalizeSettings } from "@/lib/domain/settings";
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
import { SlotTakenError } from "@/lib/db/types";
import type { Repository } from "@/lib/db/repository";

type FileShape = {
  users: UserRecord[];
  settings: Settings;
  crews: CrewRecord[];
  workers: WorkerRecord[];
  timeOff: TimeOffRecord[];
  jobs: JobRecord[];
  payments: PaymentRecord[];
  notifications: NotificationRecord[];
  emails: EmailRecord[];
  reviews: ReviewRecord[];
  library: LibraryEntry[];
  geo: Record<string, { lat: number; lng: number }>;
  routes: Record<string, { miles: number; source: string }>;
  invoiceSeq: number;
};

const als = new AsyncLocalStorage<FileShape>();

const IDS = {
  owner: "00000000-0000-4000-8000-000000000001",
  customer: "00000000-0000-4000-8000-000000000002",
  userA: "00000000-0000-4000-8000-00000000000a",
  userB: "00000000-0000-4000-8000-00000000000b",
  userC: "00000000-0000-4000-8000-00000000000c",
  userD: "00000000-0000-4000-8000-00000000000d",
  crew1: "00000000-0000-4000-8000-0000000000c1",
  crew2: "00000000-0000-4000-8000-0000000000c2",
  workerA: "00000000-0000-4000-8000-0000000000a1",
  workerB: "00000000-0000-4000-8000-0000000000b2",
  workerC: "00000000-0000-4000-8000-0000000000c3",
  workerD: "00000000-0000-4000-8000-0000000000d4",
};

export const DEMO_USERS = {
  owner: IDS.owner,
  customer: IDS.customer,
  worker: IDS.userA,
};

function seed(): FileShape {
  const settings = normalizeSettings(null);
  return {
    users: [
      {
        id: IDS.owner,
        role: "owner",
        email: "dale.orvis@exconstruction.example",
        fullName: "Dale Orvis",
        phone: "(231) 555-0100",
        billingAddress: "1339 N Mitchell St, Cadillac, MI 49601",
        billingZip: "49601",
        passwordHash: null,
        workerId: null,
      },
      {
        id: IDS.customer,
        role: "customer",
        email: "sample.customer@exconstruction.example",
        fullName: "Sample Customer",
        phone: "(231) 555-0142",
        billingAddress: "101 Example Ave, Cadillac, MI 49601",
        billingZip: "49601",
        passwordHash: null,
        workerId: null,
      },
      {
        id: IDS.userA,
        role: "worker",
        email: "worker.a@exconstruction.example",
        fullName: "Worker A (sample)",
        phone: "",
        billingAddress: "",
        billingZip: "",
        passwordHash: null,
        workerId: IDS.workerA,
      },
      {
        id: IDS.userB,
        role: "worker",
        email: "worker.b@exconstruction.example",
        fullName: "Worker B (sample)",
        phone: "",
        billingAddress: "",
        billingZip: "",
        passwordHash: null,
        workerId: IDS.workerB,
      },
      {
        id: IDS.userC,
        role: "worker",
        email: "helper.c@exconstruction.example",
        fullName: "Helper C (sample)",
        phone: "",
        billingAddress: "",
        billingZip: "",
        passwordHash: null,
        workerId: IDS.workerC,
      },
      {
        id: IDS.userD,
        role: "worker",
        email: "worker.d@exconstruction.example",
        fullName: "Worker D (sample)",
        phone: "",
        billingAddress: "",
        billingZip: "",
        passwordHash: null,
        workerId: IDS.workerD,
      },
    ],
    settings,
    crews: [
      { id: IDS.crew1, name: "Crew 1", active: true },
      { id: IDS.crew2, name: "Crew 2", active: true },
    ],
    workers: [
      {
        id: IDS.workerA,
        profileId: IDS.userA,
        fullName: "Worker A (sample)",
        email: "worker.a@exconstruction.example",
        crewId: IDS.crew1,
        dayStartMin: 450,
        dayEndMin: 1050,
        workDays: [1, 2, 3, 4, 5, 6],
        active: true,
      },
      {
        id: IDS.workerB,
        profileId: IDS.userB,
        fullName: "Worker B (sample)",
        email: "worker.b@exconstruction.example",
        crewId: IDS.crew1,
        dayStartMin: 480,
        dayEndMin: 960,
        workDays: [1, 2, 3, 4, 5, 6],
        active: true,
      },
      {
        id: IDS.workerC,
        profileId: IDS.userC,
        fullName: "Helper C (sample)",
        email: "helper.c@exconstruction.example",
        crewId: IDS.crew2,
        dayStartMin: 480,
        dayEndMin: 1020,
        workDays: [1, 2, 3, 4, 5, 6],
        active: true,
      },
      {
        id: IDS.workerD,
        profileId: IDS.userD,
        fullName: "Worker D (sample)",
        email: "worker.d@exconstruction.example",
        crewId: IDS.crew2,
        dayStartMin: 480,
        dayEndMin: 1020,
        workDays: [1, 2, 3, 4, 5, 6],
        active: true,
      },
    ],
    timeOff: [],
    jobs: [],
    payments: [],
    notifications: [],
    emails: [],
    reviews: [],
    library: mergeLibrary(null),
    geo: {},
    routes: {},
    invoiceSeq: 1000,
  };
}

function overlaps(job: JobRecord, other: JobRecord): boolean {
  if (other.id === job.id) return false;
  if (!blocksSchedule(other.status)) return false;
  if (!job.scheduledDate || other.scheduledDate !== job.scheduledDate) return false;
  if (job.reserveStartMin == null || job.reserveEndMin == null) return false;
  if (other.reserveStartMin == null || other.reserveEndMin == null) return false;
  const shares = job.workerIds.some((id) => other.workerIds.includes(id));
  if (!shares) return false;
  return job.reserveStartMin < other.reserveEndMin && other.reserveStartMin < job.reserveEndMin;
}

export class LocalRepository implements Repository {
  readonly mode = "local" as const;
  private queue: Promise<unknown> = Promise.resolve();
  private zips: ZipRecord[] | null = null;
  private readonly filePath: string;

  constructor(dir = process.env.DATA_DIR || path.join(process.cwd(), ".data")) {
    fs.mkdirSync(dir, { recursive: true });
    this.filePath = path.join(dir, "db.json");
    if (!fs.existsSync(this.filePath)) this.write(seed());
  }

  private read(): FileShape {
    const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as FileShape;
    parsed.settings = normalizeSettings(parsed.settings);
    parsed.invoiceSeq = parsed.invoiceSeq || 1000;
    parsed.library = mergeLibrary(Array.isArray(parsed.library) ? parsed.library : null);
    return parsed;
  }

  private write(data: FileShape) {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.filePath);
  }

  private db(): FileShape {
    const current = als.getStore();
    if (!current) throw new Error("Database used outside a transaction");
    return current;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (als.getStore()) return fn();
    const run = this.queue.then(async () => {
      const db = structuredClone(this.read());
      const result = await als.run(db, fn);
      this.write(db);
      return result;
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private clone<T>(value: T): T {
    return structuredClone(value);
  }

  async getSettings() {
    return this.run(async () => this.clone(this.db().settings));
  }
  async saveSettings(settings: Settings) {
    await this.run(async () => {
      this.db().settings = normalizeSettings(settings);
    });
  }
  async listLibrary() {
    return this.run(async () => this.clone(this.db().library));
  }
  async saveLibrary(entries: LibraryEntry[]) {
    await this.run(async () => {
      this.db().library = mergeLibrary(entries);
    });
  }
  async listZips() {
    if (!this.zips) {
      const file = path.join(process.cwd(), "data/zips.json");
      this.zips = JSON.parse(fs.readFileSync(file, "utf8")) as ZipRecord[];
    }
    return this.zips;
  }
  async listCrews() {
    return this.run(async () => this.clone(this.db().crews));
  }
  async saveCrew(crew: CrewRecord) {
    await this.run(async () => {
      const db = this.db();
      const i = db.crews.findIndex((c) => c.id === crew.id);
      if (i === -1) db.crews.push(this.clone(crew));
      else db.crews[i] = this.clone(crew);
    });
  }
  async deleteCrew(id: string) {
    await this.run(async () => {
      const db = this.db();
      db.crews = db.crews.filter((c) => c.id !== id);
      for (const worker of db.workers) if (worker.crewId === id) worker.crewId = null;
    });
  }
  async listWorkers() {
    return this.run(async () => this.clone(this.db().workers));
  }
  async saveWorker(worker: WorkerRecord) {
    await this.run(async () => {
      const db = this.db();
      const i = db.workers.findIndex((w) => w.id === worker.id);
      if (i === -1) db.workers.push(this.clone(worker));
      else db.workers[i] = this.clone(worker);
    });
  }
  async deleteWorker(id: string) {
    await this.run(async () => {
      const db = this.db();
      db.workers = db.workers.filter((w) => w.id !== id);
      db.timeOff = db.timeOff.filter((t) => t.workerId !== id);
      for (const user of db.users) if (user.workerId === id) user.workerId = null;
    });
  }
  async listTimeOff() {
    return this.run(async () => this.clone(this.db().timeOff));
  }
  async addTimeOff(workerId: string, date: string) {
    await this.run(async () => {
      const db = this.db();
      if (db.timeOff.some((t) => t.workerId === workerId && t.date === date)) return;
      db.timeOff.push({ id: crypto.randomUUID(), workerId, date });
    });
  }
  async removeTimeOff(id: string) {
    await this.run(async () => {
      const db = this.db();
      db.timeOff = db.timeOff.filter((t) => t.id !== id);
    });
  }
  async listJobs() {
    return this.run(async () => this.clone(this.db().jobs));
  }
  async getJob(id: string) {
    return this.run(async () => {
      const found = this.db().jobs.find((j) => j.id === id);
      return found ? this.clone(found) : null;
    });
  }
  async saveJob(job: JobRecord, opts?: SaveJobOptions) {
    return this.run(async () => {
      const db = this.db();
      const next = this.clone(job);
      next.updatedAt = new Date().toISOString();
      if (opts?.issueInvoice && next.invoiceNumber == null) {
        next.invoiceNumber = db.invoiceSeq;
        db.invoiceSeq += 1;
      }
      if (!opts?.skipOverlap && blocksSchedule(next.status) && next.workerIds.length > 0) {
        const clash = db.jobs.find((other) => overlaps(next, other));
        if (clash) throw new SlotTakenError();
      }
      const i = db.jobs.findIndex((j) => j.id === next.id);
      if (i === -1) db.jobs.push(next);
      else db.jobs[i] = next;
      return this.clone(next);
    });
  }
  async listPayments(jobId?: string) {
    return this.run(async () => {
      const rows = this.db().payments.filter((p) => !jobId || p.jobId === jobId);
      return this.clone(rows);
    });
  }
  async savePayment(payment: PaymentRecord) {
    await this.run(async () => {
      const db = this.db();
      const i = db.payments.findIndex((p) => p.id === payment.id);
      if (i === -1) db.payments.push(this.clone(payment));
      else db.payments[i] = this.clone(payment);
    });
  }
  async listNotifications() {
    return this.run(async () => this.clone(this.db().notifications));
  }
  async addNotification(note: NotificationRecord) {
    await this.run(async () => {
      this.db().notifications.unshift(this.clone(note));
    });
  }
  async markNotificationsRead() {
    await this.run(async () => {
      for (const note of this.db().notifications) note.read = true;
    });
  }
  async listEmails() {
    return this.run(async () => this.clone(this.db().emails));
  }
  async addEmail(email: EmailRecord) {
    await this.run(async () => {
      console.info(`\n[email] To: ${email.to}\nSubject: ${email.subject}\n${email.body}\n`);
      this.db().emails.unshift(this.clone(email));
    });
  }
  async markEmailSent(id: string) {
    await this.run(async () => {
      const email = this.db().emails.find((e) => e.id === id);
      if (email) email.sent = true;
    });
  }
  async listUsers() {
    return this.run(async () => this.clone(this.db().users));
  }
  async getUser(id: string) {
    return this.run(async () => {
      const user = this.db().users.find((u) => u.id === id);
      return user ? this.clone(user) : null;
    });
  }
  async getUserByEmail(email: string) {
    return this.run(async () => {
      const user = this.db().users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      return user ? this.clone(user) : null;
    });
  }
  async saveUser(user: UserRecord) {
    await this.run(async () => {
      const db = this.db();
      const i = db.users.findIndex((u) => u.id === user.id);
      if (i === -1) db.users.push(this.clone(user));
      else db.users[i] = this.clone(user);
      if (user.workerId) {
        const worker = db.workers.find((w) => w.id === user.workerId);
        if (worker) worker.profileId = user.id;
      }
    });
  }
  async listReviews() {
    return this.run(async () => this.clone(this.db().reviews));
  }
  async getReview(jobId: string) {
    return this.run(async () => {
      const review = this.db().reviews.find((r) => r.jobId === jobId);
      return review ? this.clone(review) : null;
    });
  }
  async saveReview(review: ReviewRecord) {
    await this.run(async () => {
      const db = this.db();
      const i = db.reviews.findIndex((r) => r.jobId === review.jobId);
      if (i === -1) db.reviews.push(this.clone(review));
      else db.reviews[i] = this.clone(review);
    });
  }
  async getGeo(key: string) {
    return this.run(async () => this.db().geo[key] ?? null);
  }
  async saveGeo(key: string, point: { lat: number; lng: number }) {
    await this.run(async () => {
      this.db().geo[key] = point;
    });
  }
  async getRoute(key: string) {
    return this.run(async () => this.db().routes[key] ?? null);
  }
  async saveRoute(key: string, miles: number, source: string) {
    await this.run(async () => {
      this.db().routes[key] = { miles, source };
    });
  }
}
