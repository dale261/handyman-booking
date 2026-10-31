import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer, safeNext } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/db/index";

/**
 * Where Supabase sends people after they click a recovery (or confirmation) link.
 * The link carries a one-time code; swapping it for a session here sets the auth
 * cookies, and the person lands on the page that lets them choose a new password.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeNext(url.searchParams.get("next")) ?? "/reset";
  const back = (message: string) => NextResponse.redirect(new URL(`/forgot?error=${encodeURIComponent(message)}`, url.origin));
  if (!supabaseConfigured()) return back("Password reset links only work on the live site.");
  const described = url.searchParams.get("error_description") || url.searchParams.get("error");
  if (described) return back(`That link didn't work (${described}). Ask for a new one.`);

  const supabase = await createSupabaseServer();
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    console.error("[auth] code exchange failed", error.message);
    return back("That link has expired or was opened in a different browser than the one you asked from. Ask for a new one and open it in the same browser.");
  }
  if (tokenHash && (type === "recovery" || type === "email" || type === "signup" || type === "magiclink" || type === "invite")) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
    console.error("[auth] token verify failed", error.message);
    return back("That link has expired or was already used. Ask for a new one.");
  }
  return back("That link is missing its code. Ask for a new one.");
}
