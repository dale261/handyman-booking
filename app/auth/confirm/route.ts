import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServer, currentActor, homeFor, safeNext } from "@/lib/auth";
import { getRepository, supabaseConfigured } from "@/lib/db/index";
import { finishDraft } from "@/lib/draft-finish";

/**
 * Where Supabase sends people after they click a recovery or confirmation link.
 * The link carries a one-time code; swapping it for a session here sets the auth
 * cookies. A recovery link says next=/reset and lands on the new-password page.
 * A sign-up confirmation has no next: if the person priced a job before signing
 * up, that job is created now and they land on it, ready to pick a time.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const asked = safeNext(url.searchParams.get("next"));
  const landing = async () => {
    if (asked) return asked;
    const actor = await currentActor();
    if (!actor) return "/login";
    const finished = await finishDraft(getRepository(), actor).catch((error) => {
      console.error("[auth] finishing the saved quote failed", error);
      return null;
    });
    return finished ?? homeFor(actor.role);
  };
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
    if (!error) return NextResponse.redirect(new URL(await landing(), url.origin));
    console.error("[auth] code exchange failed", error.message);
    return back("That link has expired or was opened in a different browser than the one you asked from. Ask for a new one and open it in the same browser.");
  }
  // A reset link waits for a tap on its own page, so a mail scanner opening the link can't use it up.
  if (tokenHash && type === "recovery") {
    return NextResponse.redirect(new URL(`/reset/open?token_hash=${encodeURIComponent(tokenHash)}`, url.origin));
  }
  if (tokenHash && (type === "email" || type === "signup" || type === "magiclink" || type === "invite")) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(await landing(), url.origin));
    console.error("[auth] token verify failed", error.message);
    return back("That link has expired or was already used. Ask for a new one.");
  }
  return back("That link is missing its code. Ask for a new one.");
}
