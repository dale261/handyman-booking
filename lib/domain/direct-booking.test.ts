import { describe, expect, it } from "vitest";
import { directBookingBlurb, directBookingServices, quoteToolServices } from "./direct-booking";
import { PREAPPROVED, SERVICE_LABELS } from "./types";

describe("direct booking list", () => {
  it("matches the quote tool's bookable services and keeps Hire a helper last", () => {
    const bookable = quoteToolServices().filter((id) => id !== "other");
    expect(bookable).toEqual(PREAPPROVED);
    expect(directBookingServices().slice().sort()).toEqual([...bookable].sort());
    expect(directBookingServices().at(-1)).toBe("helper");
    expect(directBookingBlurb()).toBe(
      "Painting, including large jobs. Household cleaning. Yard cleanup. TV mounting, blinds and curtains. Furniture assembly. Drain clearing. Hire a helper.",
    );
    expect(directBookingBlurb()).not.toContain(SERVICE_LABELS.other);
    expect(directBookingBlurb().endsWith("Hire a helper.")).toBe(true);
  });

  it("drops a service from the home sentence when it is no longer bookable", () => {
    const withoutYard = PREAPPROVED.filter((id) => id !== "yard");
    expect(directBookingBlurb(withoutYard)).toBe(
      "Painting, including large jobs. Household cleaning. TV mounting, blinds and curtains. Furniture assembly. Drain clearing. Hire a helper.",
    );
    expect(directBookingBlurb(withoutYard)).not.toContain("Yard cleanup");
    const withoutBlinds = PREAPPROVED.filter((id) => id !== "blinds");
    expect(directBookingBlurb(withoutBlinds)).toContain("TV mounting");
    expect(directBookingBlurb(withoutBlinds)).not.toContain("blinds and curtains");
    expect(directBookingServices(withoutBlinds)).not.toContain("blinds");
  });
});
