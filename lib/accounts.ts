import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import { supabaseConfigured } from "@/lib/db/index";
import type { Actor, UserRecord } from "@/lib/db/types";
import { isPlaceholderEmail, phoneDigits, placeholderEmail, realEmail } from "@/lib/domain/contact";
import { hashPassword } from "@/lib/password";

export type CustomerDetails = {
  fullName: string;
  /** Optional. A customer with only a phone number gets a stand-in address that is never written to. */
  email: string;
  phone: string;
  /** Optional for finished work; the caller decides when an address is required. */
  billingAddress: string;
  billingZip: string;
  /** Optional. When blank the account gets a random password nobody knows; the contract link still works. */
  password: string;
};

export type EnsureCustomerResult =
  | { ok: true; user: UserRecord; created: boolean }
  | { ok: false; error: string };

/**
 * Find the customer by email, or create their account so the job has someone to belong to.
 * Existing customers keep their account; blank details on the form fall back to what's on file.
 */
export async function ensureCustomerAccount(repo: Repository, details: CustomerDetails): Promise<EnsureCustomerResult> {
  const typed = details.email.trim().toLowerCase();
  const digits = phoneDigits(details.phone);
  // No email: the phone number is how we recognize them. A returning customer with the
  // same number is reused (whatever email they have); otherwise a stand-in address is made.
  let email = isPlaceholderEmail(typed) ? "" : typed;
  let existing: UserRecord | null = null;
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right. Fix it, or leave it blank and text them the link." };
    existing = await repo.getUserByEmail(email);
  } else {
    if (digits.length < 7) return { ok: false, error: "Without an email, the customer needs a phone number." };
    const users = await repo.listUsers();
    existing = users.find((user) => user.role === "customer" && phoneDigits(user.phone) === digits) ?? null;
    if (!existing) {
      email = placeholderEmail(details.phone);
      existing = await repo.getUserByEmail(email);
    }
  }
  if (existing) {
    if (existing.role !== "customer") return { ok: false, error: "That email belongs to a worker or the owner. Use the customer's own email." };
    const merged: UserRecord = {
      ...existing,
      fullName: details.fullName.trim() || existing.fullName,
      phone: details.phone.trim() || existing.phone,
      billingAddress: details.billingAddress.trim() || existing.billingAddress,
      billingZip: /^\d{5}$/.test(details.billingZip.trim()) ? details.billingZip.trim() : existing.billingZip,
    };
    if (
      merged.fullName !== existing.fullName ||
      merged.phone !== existing.phone ||
      merged.billingAddress !== existing.billingAddress ||
      merged.billingZip !== existing.billingZip
    ) {
      await repo.saveUser(merged);
    }
    return { ok: true, user: merged, created: false };
  }

  if (!details.fullName.trim()) return { ok: false, error: "Enter the customer's name." };
  const password = details.password || randomBytes(18).toString("base64url");
  if (password.length < 8) return { ok: false, error: "A temporary password needs at least 8 characters." };
  const base = {
    role: "customer" as const,
    email,
    fullName: details.fullName.trim(),
    phone: details.phone.trim(),
    billingAddress: details.billingAddress.trim(),
    billingZip: details.billingZip.trim(),
    workerId: null,
  };

  if (!supabaseConfigured()) {
    const user: UserRecord = { id: randomUUID(), ...base, passwordHash: hashPassword(password) };
    await repo.saveUser(user);
    return { ok: true, user, created: true };
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "", {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: base.fullName,
      phone: base.phone,
      billing_address: base.billingAddress,
      billing_zip: base.billingZip,
    },
  });
  if (error || !data.user) return { ok: false, error: error?.message || "Could not create the customer's account." };
  const user: UserRecord = { id: data.user.id, ...base, passwordHash: null };
  // The database trigger creates the profile from the metadata; this makes sure every field is filled.
  await repo.saveUser(user);
  return { ok: true, user, created: true };
}

export type ContactFix = {
  fullName: string;
  /** Blank means "no email": nothing is sent, the owner texts the link. */
  email: string;
  phone: string;
  billingAddress: string;
  billingZip: string;
};

/**
 * Owner only: correct a customer's contact details after the fact (a mistyped email that
 * bounces, a new phone number). Updates the account and every job of that customer, so the
 * next email goes to the right place. The job site address and anything priced from it
 * are left alone; use "Fix the write-up" for the work itself.
 */
export async function updateCustomerContact(
  repo: Repository,
  actor: Actor,
  jobId: string,
  fix: ContactFix,
): Promise<{ ok: true; user: UserRecord; jobsUpdated: number; emailChanged: boolean } | { ok: false; error: string }> {
  if (actor.role !== "owner") return { ok: false, error: "Only the owner can change a customer's details." };
  const job = await repo.getJob(jobId);
  if (!job) return { ok: false, error: "Job not found." };
  const user = await repo.getUser(job.customerId);
  if (!user) return { ok: false, error: "This job's customer account can't be found." };

  const fullName = fix.fullName.trim();
  if (!fullName) return { ok: false, error: "Enter the customer's name." };
  const phone = fix.phone.trim();
  if (phoneDigits(phone).length < 7) return { ok: false, error: "Enter the customer's phone number." };
  const billingZip = fix.billingZip.trim();
  if (billingZip && !/^\d{5}$/.test(billingZip)) return { ok: false, error: "The billing ZIP must be 5 digits, or blank." };
  const typed = fix.email.trim().toLowerCase();
  const email = isPlaceholderEmail(typed) ? "" : typed;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };

  // A real email moves with the account, so sign-in and future jobs use it too.
  const accountEmail = email || user.email;
  const emailChanged = accountEmail.toLowerCase() !== user.email.toLowerCase();
  if (emailChanged) {
    const taken = await repo.getUserByEmail(accountEmail);
    if (taken && taken.id !== user.id) return { ok: false, error: `${accountEmail} already belongs to another account (${taken.fullName || taken.role}). Use that customer, or a different address.` };
    if (supabaseConfigured()) {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || "", process.env.SUPABASE_SERVICE_ROLE_KEY || "", {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await admin.auth.admin.updateUserById(user.id, { email: accountEmail, email_confirm: true });
      if (error) return { ok: false, error: `Couldn't change the account email: ${error.message}` };
    }
  }
  const updated: UserRecord = {
    ...user,
    email: accountEmail,
    fullName,
    phone,
    billingAddress: fix.billingAddress.trim(),
    billingZip,
  };
  await repo.saveUser(updated);

  // Every job of theirs carries a copy of the contact details; keep them all current.
  const jobs = (await repo.listJobs()).filter((item) => item.customerId === user.id);
  // Blanked by the owner means "don't email them", even though the account keeps its address for sign-in.
  const customerEmail = email ? realEmail(accountEmail) : "";
  for (const item of jobs) {
    item.customerName = fullName;
    item.customerPhone = phone;
    item.customerEmail = customerEmail;
    item.billingAddress = updated.billingAddress;
    await repo.saveJob(item, { skipOverlap: true });
  }
  return { ok: true, user: updated, jobsUpdated: jobs.length, emailChanged };
}
