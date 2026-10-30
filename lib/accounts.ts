import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import type { Repository } from "@/lib/db/repository";
import { supabaseConfigured } from "@/lib/db/index";
import type { UserRecord } from "@/lib/db/types";
import { hashPassword } from "@/lib/password";

export type CustomerDetails = {
  fullName: string;
  email: string;
  phone: string;
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
  const email = details.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter the customer's email address." };
  const existing = await repo.getUserByEmail(email);
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
