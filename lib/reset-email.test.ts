import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { resetBody, resetLink, resetOrigin, resetSubject } from "@/lib/reset-email";

describe("reset email", () => {
  it("links to the button page on the live address", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://example.test/", VERCEL_ENV: "production", VERCEL_URL: "x.vercel.app" } as unknown as NodeJS.ProcessEnv;
    expect(resetLink("abc+/=", env)).toBe("https://example.test/reset/open?token_hash=abc%2B%2F%3D");
  });

  it("links a preview build to itself", () => {
    const env = { NEXT_PUBLIC_APP_URL: "https://example.test", VERCEL_ENV: "preview", VERCEL_URL: "branch-abc.vercel.app" } as unknown as NodeJS.ProcessEnv;
    expect(resetOrigin(env)).toBe("https://branch-abc.vercel.app");
  });

  it("puts the Michigan time in the subject", () => {
    expect(resetSubject(new Date("2026-11-10T13:57:00Z"))).toBe("Reset your eX Construction password (8:57 AM)");
  });

  it("carries the link on its own line", () => {
    expect(resetBody("https://example.test/reset/open?token_hash=a").split("\n")).toContain("https://example.test/reset/open?token_hash=a");
  });
});
