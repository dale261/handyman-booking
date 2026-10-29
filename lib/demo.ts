/** Shown when PayPal is not connected and the test-payment button is turned off. */
export const DEMO_PAY_UNAVAILABLE =
  "Online payment isn't set up on this site yet. We'll contact you to take payment.";

/**
 * Sample one-click sign-in is for `npm run dev` before Supabase is connected.
 * A public deploy must not offer it unless DEMO_MODE is explicitly "true".
 */
export function demoSignInAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.DEMO_MODE === "true") return true;
  if (env.NODE_ENV === "production") return false;
  if (env.NEXT_PUBLIC_SUPABASE_URL && env.NEXT_PUBLIC_SUPABASE_ANON_KEY && env.SUPABASE_SERVICE_ROLE_KEY) return false;
  return true;
}
