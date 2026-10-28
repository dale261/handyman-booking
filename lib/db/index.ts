import "server-only";
import { LocalRepository } from "@/lib/db/local";
import type { Repository } from "@/lib/db/repository";
import { SupabaseRepository } from "@/lib/db/supabase";

let local: LocalRepository | null = null;
let remote: SupabaseRepository | null = null;

export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

/** The file store is for `npm run dev` on Dale's computer. A public site must use Supabase. */
export function databaseReady(): boolean {
  if (supabaseConfigured()) return true;
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_LOCAL_DB !== "1") return false;
  return true;
}

export function getRepository(): Repository {
  if (!databaseReady()) {
    throw new Error("Connect Supabase before running this site for customers. The saved-file demo is only for npm run dev.");
  }
  if (supabaseConfigured()) {
    remote ??= new SupabaseRepository();
    return remote;
  }
  local ??= new LocalRepository();
  return local;
}
