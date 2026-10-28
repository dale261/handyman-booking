import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const redirects: string[] = [];

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    redirects.push(url);
    throw new Error("NEXT_REDIRECT");
  },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => ({ get: () => null }),
}));

import { demoPayAction } from "./actions";
import { DEMO_PAY_UNAVAILABLE, demoSignInAllowed } from "./demo";

const saved = {
  NODE_ENV: process.env.NODE_ENV,
  DEMO_MODE: process.env.DEMO_MODE,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
  redirects.length = 0;
  restore("NODE_ENV", saved.NODE_ENV);
  restore("DEMO_MODE", saved.DEMO_MODE);
  restore("NEXT_PUBLIC_SUPABASE_URL", saved.NEXT_PUBLIC_SUPABASE_URL);
  restore("NEXT_PUBLIC_SUPABASE_ANON_KEY", saved.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  restore("SUPABASE_SERVICE_ROLE_KEY", saved.SUPABASE_SERVICE_ROLE_KEY);
});

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function form() {
  const data = new FormData();
  data.set("jobId", "job-1");
  return data;
}

describe("demo test payment", () => {
  it("refuses the action and hides the form when demo sign-in is off", async () => {
    process.env.NODE_ENV = "production";
    delete process.env.DEMO_MODE;
    expect(demoSignInAllowed()).toBe(false);

    await expect(demoPayAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirects).toEqual([`/jobs/job-1?error=${encodeURIComponent(DEMO_PAY_UNAVAILABLE)}`]);
  });

  it("does not refuse the action when demo sign-in is on", async () => {
    process.env.NODE_ENV = "development";
    delete process.env.DEMO_MODE;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(demoSignInAllowed()).toBe(true);

    await expect(demoPayAction(form())).rejects.toThrow("NEXT_REDIRECT");
    expect(redirects).toEqual(["/login"]);
    expect(redirects.join(" ")).not.toContain(DEMO_PAY_UNAVAILABLE);
  });
});
