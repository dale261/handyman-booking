import { describe, expect, it } from "vitest";
import { parsePastedContact } from "@/lib/domain/paste-contact";

describe("parsePastedContact", () => {
  it("reads a labeled website form email", () => {
    const got = parsePastedContact(
      ["Name: Tina Marsh", "Email: tina.marsh@hotmail.com", "Phone: (231) 555-0142", "Address: 412 Pine St, Cadillac, MI 49601", "Message: I need two bedrooms painted before Christmas.", "Walls only, no ceilings."].join("\n"),
    );
    expect(got.fullName).toBe("Tina Marsh");
    expect(got.email).toBe("tina.marsh@hotmail.com");
    expect(got.phone).toBe("231-555-0142");
    expect(got.address).toBe("412 Pine St, Cadillac, MI 49601");
    expect(got.zip).toBe("49601");
    expect(got.details).toBe("I need two bedrooms painted before Christmas.\nWalls only, no ceilings.");
    expect(got.service).toBe("paint");
  });

  it("reads a plain text message with no labels", () => {
    const got = parsePastedContact("Sam Ortega\n231.555.0199\n88 Lake Rd, Manton MI 49663\nCan you hang a 65 inch TV over the fireplace?");
    expect(got.fullName).toBe("Sam Ortega");
    expect(got.phone).toBe("231-555-0199");
    expect(got.address).toBe("88 Lake Rd, Manton MI 49663");
    expect(got.zip).toBe("49663");
    expect(got.email).toBe("");
    expect(got.details).toBe("Can you hang a 65 inch TV over the fireplace?");
    expect(got.service).toBe("tv");
  });

  it("joins first and last name, city and state, and answers on the next line", () => {
    const got = parsePastedContact("First Name: Lee\nLast Name: Park\nPhone:\n12315550111\nStreet Address: 9 Oak Ave\nCity: Lake City\nState: MI\nZip Code: 49651\nService: Deck repair\nDetails: two loose boards");
    expect(got.fullName).toBe("Lee Park");
    expect(got.phone).toBe("231-555-0111");
    expect(got.address).toBe("9 Oak Ave, Lake City, MI");
    expect(got.zip).toBe("49651");
    expect(got.service).toBe("");
    expect(got.details).toBe("Deck repair\ntwo loose boards");
  });

  it("leaves blanks blank and never mistakes a phone for a ZIP", () => {
    const got = parsePastedContact("call me 2315550123 about cleaning");
    expect(got.phone).toBe("231-555-0123");
    expect(got.zip).toBe("");
    expect(got.fullName).toBe("");
    expect(got.service).toBe("clean");
  });
});
