import "server-only";
import { headers } from "next/headers";
import { clientIp } from "@/lib/client-ip";
import { getRepository } from "@/lib/db/index";

type HeaderSource = { get(name: string): string | null };

/** Sign-in, sign-up, sample sign-in, photo upload, and the PayPal return. */
export const ANON_LIMIT = { bucket: "anon", max: 40, windowMs: 10 * 60 * 1000 };

/** Quote requests. Booking tests call createQuote directly and are not counted here. */
export const QUOTE_LIMIT = { bucket: "quote", max: 12, windowMs: 60 * 60 * 1000 };

/** New leads from the public price page: new phone numbers per network per hour. Re-checks from the same phone are not counted. */
export const LEAD_LIMIT = { bucket: "lead", max: 6, windowMs: 60 * 60 * 1000 };

const memory = new Map<string, { windowStart: number; hits: number }>();

function memoryAllow(bucket: string, ip: string, max: number, windowMs: number): boolean {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const row = memory.get(key);
  if (!row || now - row.windowStart >= windowMs) {
    memory.set(key, { windowStart: now, hits: 1 });
    return max >= 1;
  }
  if (row.hits >= max) return false;
  row.hits += 1;
  return true;
}

/**
 * True when this IP may continue. Tests skip the check.
 * The Supabase table is the real limit. Memory is only if that call fails.
 */
export async function allowRequest(
  limit: { bucket: string; max: number; windowMs: number },
  headerSource?: HeaderSource,
): Promise<boolean> {
  if (process.env.VITEST) return true;
  const source = headerSource ?? (await headers());
  const ip = clientIp(source);
  try {
    const result = await getRepository().hitRateLimit(limit.bucket, ip, limit.max, limit.windowMs);
    return result.allowed;
  } catch (error) {
    console.error("[rate] limit check failed, using a short memory window", error);
    return memoryAllow(limit.bucket, ip, limit.max, limit.windowMs);
  }
}
