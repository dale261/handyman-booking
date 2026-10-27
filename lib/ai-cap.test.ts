import { describe, expect, it } from "vitest";
import { aiModeFromReservation } from "./ai-cap";

describe("AI quote mode", () => {
  it("keeps keyword quoting when there is no key", () => {
    expect(aiModeFromReservation(false, false, null)).toBe("fallback");
    expect(aiModeFromReservation(false, true, false)).toBe("fallback");
  });

  it("caps when the reservation is refused, including during tests", () => {
    expect(aiModeFromReservation(true, false, false)).toBe("capped");
    expect(aiModeFromReservation(true, true, false)).toBe("capped");
  });

  it("does not call the model during tests when the reservation is allowed", () => {
    expect(aiModeFromReservation(true, true, true)).toBe("fallback");
    expect(aiModeFromReservation(true, false, true)).toBe("model");
  });
});
