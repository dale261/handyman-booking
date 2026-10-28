import { demoSignInAllowed } from "@/lib/demo";
import { supabaseConfigured } from "@/lib/db/index";
import { resendConfigured } from "@/lib/email";
import { paypalConfigured } from "@/lib/paypal";

export type KeyStatus = {
  supabase: boolean;
  resend: boolean;
  paypal: boolean;
  openai: boolean;
  anthropic: boolean;
  ors: boolean;
  osrm: boolean;
  localDemo: boolean;
};

export function keyStatus(): KeyStatus {
  return {
    supabase: supabaseConfigured(),
    resend: resendConfigured(),
    paypal: paypalConfigured(),
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    ors: Boolean(process.env.ORS_API_KEY),
    osrm: Boolean(process.env.OSRM_BASE_URL),
    localDemo: demoSignInAllowed(),
  };
}
