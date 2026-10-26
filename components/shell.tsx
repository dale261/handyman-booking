import Link from "next/link";
import { signOut } from "@/lib/actions";
import type { Actor } from "@/lib/db/types";
import type { KeyStatus } from "@/lib/keys";
import { Button } from "@/components/ui/button";

export function Shell({
  actor,
  keys,
  ready,
  children,
}: {
  actor: Actor | null;
  keys: KeyStatus | null;
  ready: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-card/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
          <Link href="/" className="font-display text-lg font-semibold tracking-tight text-pine">
            eX Construction LC
          </Link>
          <nav className="flex flex-wrap items-center gap-1 text-sm">
            <Nav href="/book">Get a quote</Nav>
            {actor?.role === "customer" && <Nav href="/jobs">My jobs</Nav>}
            {actor?.role === "worker" && <Nav href="/worker">My crew</Nav>}
            {actor?.role === "owner" && (
              <>
                <Nav href="/owner">Today</Nav>
                <Nav href="/owner/queue">Queue</Nav>
                <Nav href="/owner/jobs">Jobs</Nav>
                <Nav href="/owner/settings">Rates</Nav>
                <Nav href="/owner/area">ZIP map</Nav>
              </>
            )}
            {actor ? (
              <>
                <Nav href="/account">{actor.fullName.split(" ")[0] || "Account"}</Nav>
                <form action={signOut}>
                  <Button type="submit" variant="ghost" size="sm">
                    Sign out
                  </Button>
                </form>
              </>
            ) : (
              <>
                <Nav href="/login">Sign in</Nav>
                <Nav href="/signup">Create account</Nav>
              </>
            )}
          </nav>
        </div>
      </header>
      {ready && keys?.localDemo && (
        <div className="border-b border-copper/30 bg-copper/10">
          <p className="mx-auto max-w-6xl px-4 py-2 text-sm text-ink">
            This copy is saving to a file on this computer. Sample one-click sign-in is on. Do not put this mode on the public internet. Connect Supabase before customers use it.
            {keys.resend ? " Email is live." : " Emails print in the terminal."}
            {keys.paypal ? " PayPal is live." : " PayPal is a demo button until keys are added."}
            {keys.openai ? " AI quote notes are on." : " Quotes use the rate table until an OpenAI key is added."}
            {keys.ors ? " Road miles use OpenRouteService." : keys.osrm ? " Road miles use OSRM." : " Road miles are straight-line distance × the road factor until a routing key is added."}
          </p>
        </div>
      )}
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      <footer className="border-t border-line py-8 text-center text-sm text-muted">
        eX Construction LC · 1339 N Mitchell St, Cadillac, MI · Handyman booking for the 231
      </footer>
    </div>
  );
}

function Nav({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-md px-2.5 py-1.5 font-semibold text-ink hover:bg-black/5">
      {children}
    </Link>
  );
}
