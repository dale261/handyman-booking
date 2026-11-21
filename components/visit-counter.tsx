"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

// Free, cookie-less visit counting with GoatCounter: the same counter the
// marketing site (exconstructionlc.com) uses, so both show on one dashboard.
// Booking app pages are recorded under /app/... to keep them apart from the
// marketing site's pages. No names, phone numbers or job details are sent.

type CountVars = { path?: string; title?: string; event?: boolean };

declare global {
  interface Window {
    goatcounter?: { count?: (vars: CountVars) => void };
  }
}

const COUNTER_URL = "https://exconstruction.goatcounter.com/count";
const NOT_COUNTED = ["/owner", "/worker", "/api"];

function whenReady(send: () => void) {
  let tries = 0;
  let timer: number | undefined;
  const attempt = () => {
    if (window.goatcounter?.count) {
      try {
        send();
      } catch {
        // Counting must never break a page.
      }
    } else if (tries < 20) {
      tries += 1;
      timer = window.setTimeout(attempt, 300);
    }
  };
  attempt();
  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

// A named step in the flow, such as "price-shown". Shows on the dashboard as app-<name>.
export function countStep(name: string) {
  if (typeof window === "undefined") return;
  whenReady(() => window.goatcounter?.count?.({ path: `app-${name}`, title: `Booking app: ${name}`, event: true }));
}

export function VisitCounter() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || NOT_COUNTED.some((prefix) => pathname.startsWith(prefix))) return;
    // Job and contract addresses contain private ids, so they are recorded as one page each.
    const page = pathname.replace(/^\/(jobs|contract)\/[^/]+/, "/$1/id");
    return whenReady(() => window.goatcounter?.count?.({ path: `/app${page === "/" ? "" : page}` }));
  }, [pathname]);

  return (
    <Script
      src="https://gc.zgo.at/count.js"
      strategy="afterInteractive"
      data-goatcounter={COUNTER_URL}
      data-goatcounter-settings='{"no_onload": true}'
    />
  );
}
