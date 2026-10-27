import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

describe("client IP", () => {
  it("uses the first forwarded hop, then x-real-ip, and caps the length", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "203.0.113.8, 10.0.0.1" }))).toBe("203.0.113.8");
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBe("unknown");
    const huge = "a".repeat(120);
    expect(clientIp(new Headers({ "x-real-ip": huge }))).toHaveLength(80);
  });
});
