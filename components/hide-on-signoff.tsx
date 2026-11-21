"use client";

import { usePathname } from "next/navigation";

/**
 * Leaves the site's header and footer off the on-site sign-off screen. That screen is
 * handed to whoever is at the job (often a store manager on a white-label job), so it
 * must not show the eX Construction name or logo.
 */
export function HideOnSignOff({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname?.endsWith("/signoff")) return null;
  return <>{children}</>;
}
