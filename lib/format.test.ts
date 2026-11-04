import { describe, expect, it } from "vitest";
import { appUrl, formatMinutes, usd } from "./format";

describe("site address for emails and PayPal", () => {
  it("uses NEXT_PUBLIC_APP_URL when it is set", () => {
    expect(appUrl({ NEXT_PUBLIC_APP_URL: "https://book.exconstructionlc.com/" })).toBe("https://book.exconstructionlc.com");
  });

  it("falls back to the Vercel production domain, never to 127.0.0.1, on the live site", () => {
    expect(appUrl({ VERCEL_PROJECT_PRODUCTION_URL: "project-3u2ad.vercel.app", VERCEL_URL: "project-3u2ad-abc123.vercel.app" })).toBe("https://project-3u2ad.vercel.app");
    expect(appUrl({ VERCEL_URL: "project-3u2ad-abc123.vercel.app" })).toBe("https://project-3u2ad-abc123.vercel.app");
    expect(appUrl({ NEXT_PUBLIC_APP_URL: "  ", VERCEL_PROJECT_PRODUCTION_URL: "https://project-3u2ad.vercel.app/" })).toBe("https://project-3u2ad.vercel.app");
  });

  it("points at the local dev server when nothing is set", () => {
    expect(appUrl({})).toBe("http://127.0.0.1:43123");
  });
});

describe("money and time formatting", () => {
  it("formats dollars and clock times the way customers read them", () => {
    expect(usd(275)).toBe("$275.00");
    expect(usd(1234.5)).toBe("$1,234.50");
    expect(formatMinutes(8 * 60)).toBe("8:00 a.m.");
    expect(formatMinutes(13 * 60 + 30)).toBe("1:30 p.m.");
  });
});
