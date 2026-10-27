import type { Metadata, Viewport } from "next";
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
  title: "eX Construction",
  description: "Book handyman work with eX Construction in Cadillac, Michigan.",
  icons: {
    icon: [{ url: "/brand/icon.png", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/brand/apple-touch.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "eX Construction",
    description: "Book handyman work with eX Construction in Cadillac, Michigan.",
    images: [{ url: "/brand/og.png", width: 1200, height: 630, alt: "eX Construction" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#313233",
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
              <h1 className="font-display text-3xl font-semibold text-ink">This site isn&apos;t connected yet</h1>
              <p>eX Construction isn&apos;t taking bookings on this address until the database is connected. Please check back soon.</p>
              <p className="text-sm text-muted">If you&apos;re Dale, the README walks through connecting Supabase, email, PayPal, and the quote notes.</p>
            </section>
          )}
        </Shell>
      </body>
    </html>
  );
}
