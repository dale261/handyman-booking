import type { Metadata } from "next";
import { Fraunces, Source_Sans_3 } from "next/font/google";
import { Shell } from "@/components/shell";
import { currentActor } from "@/lib/auth";
import { databaseReady } from "@/lib/db/index";
import { keyStatus } from "@/lib/keys";
import "./globals.css";

const sans = Source_Sans_3({ subsets: ["latin"], variable: "--font-source" });
const display = Fraunces({ subsets: ["latin"], variable: "--font-fraunces" });

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "eX Construction LC",
  description: "Book handyman work with eX Construction LC in Cadillac, Michigan.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const ready = databaseReady();
  let actor = null;
  let keys = null;
  if (ready) {
    try {
      actor = await currentActor();
      keys = keyStatus();
    } catch {
      actor = null;
    }
  }

  return (
    <html lang="en">
      <body className={`${sans.variable} ${display.variable} antialiased`}>
        <Shell actor={actor} keys={keys} ready={ready}>
          {ready ? (
            children
          ) : (
            <section className="mx-auto max-w-xl space-y-3">
              <h1 className="font-display text-3xl font-semibold text-pine">This site is not connected yet</h1>
              <p>
                The public site needs Dale&apos;s free Supabase project before anyone can sign in. Until those three keys are in the host&apos;s environment, the booking file stays on a private computer and sample sign-in stays off.
              </p>
              <p className="text-sm text-muted">The README walks through the Supabase, Resend, PayPal, and OpenAI steps in order.</p>
            </section>
          )}
        </Shell>
      </body>
    </html>
  );
}
