import { describe, expect, it } from "vitest";
import { demoSignInAllowed } from "./demo";

describe("demo sign-in", () => {
  it("is on for local dev without Supabase", () => {
    expect(demoSignInAllowed({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
  });

  it("is off in production", () => {
    expect(demoSignInAllowed({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
  });

  it("is off when the Supabase env vars are set", () => {
    expect(
      demoSignInAllowed({
        NODE_ENV: "development",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
      } as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("stays on in dev when only one Supabase var is set", () => {
    expect(
      demoSignInAllowed({
        NODE_ENV: "development",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });

  it("is on only when DEMO_MODE is the string true", () => {
    expect(
      demoSignInAllowed({
        NODE_ENV: "production",
        DEMO_MODE: "true",
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon",
        SUPABASE_SERVICE_ROLE_KEY: "service",
      } as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(demoSignInAllowed({ NODE_ENV: "production", DEMO_MODE: "1" } as NodeJS.ProcessEnv)).toBe(false);
  });
});
