import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRepository, supabaseConfigured } from "@/lib/db/index";
import { actorFromUser, type Actor, type Role, type UserRecord } from "@/lib/db/types";

const COOKIE = "ex_session";

export async function createSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Supabase URL and anon key are required.");
  const jar = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return jar.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) jar.set(name, value, options);
        } catch {
          /* Server Components can't set cookies. Middleware refreshes the session. */
        }
      },
    },
  });
}

export async function currentActor(): Promise<Actor | null> {
  if (supabaseConfigured()) {
    const supabase = await createSupabaseServer();
    const { data } = await supabase.auth.getUser();
    if (!data.user) return null;
    const user = await getRepository().getUser(data.user.id);
    return user ? actorFromUser(user) : null;
  }
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (!id) return null;
  const user = await getRepository().getUser(id);
  return user ? actorFromUser(user) : null;
}

export async function currentUser(): Promise<UserRecord | null> {
  const actor = await currentActor();
  if (!actor) return null;
  return getRepository().getUser(actor.id);
}

export async function requireActor(): Promise<Actor> {
  const actor = await currentActor();
  if (!actor) redirect("/login");
  return actor;
}

export async function requireRole(role: Role): Promise<Actor> {
  const actor = await requireActor();
  if (actor.role !== role) redirect(homeFor(actor.role));
  return actor;
}

export function homeFor(role: Role): string {
  if (role === "owner") return "/owner";
  if (role === "worker") return "/worker";
  return "/jobs";
}

export async function setLocalSession(userId: string) {
  const jar = await cookies();
  jar.set(COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearLocalSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export function safeNext(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}
