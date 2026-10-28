import { describe, expect, it } from "vitest";
import { mergeListedAssumptions, noteFitsService } from "./service-notes";

const TV_NOTES = [
  "From your description: Mount a 55-inch TV on a drywall living-room wall",
  "TV mounting bracket provided by the homeowner",
  "Wall studs are accessible",
];

describe("service notes", () => {
  it("drops TV-mount notes from a painting quote and keeps the paint assumptions", () => {
    const merged = mergeListedAssumptions(
      "paint",
      [
        "Premium paint, 2 coats, included",
        "Furniture moved and covered, floors protected, daily cleanup",
        "Price shown is a firm quote for the scope described; surprises found on site mean a revised quote",
      ],
      {
        scopeHint: "Mount a 55-inch TV on a drywall living-room wall",
        assumptions: ["TV mounting bracket provided by the homeowner", "Wall studs are accessible", "Two coats of the color you pick"],
      },
    );

    const text = merged.join(" ");
    expect(text).not.toMatch(/TV|television|mounting bracket|wall studs/i);
    expect(merged[0]).toMatch(/Premium paint/);
    expect(merged.some((note) => /two coats of the color/i.test(note))).toBe(true);
    for (const note of TV_NOTES) expect(merged).not.toContain(note);
  });

  it("keeps TV notes when the selected service is TV mounting", () => {
    expect(noteFitsService("tv", "TV mounting bracket provided by the homeowner")).toBe(true);
    expect(noteFitsService("tv", "Wall studs are accessible")).toBe(true);
    const merged = mergeListedAssumptions(
      "tv",
      ["Customer supplies the TV and mount (or we supply at cost)"],
      {
        scopeHint: "Mount a 55-inch TV on a drywall living-room wall",
        assumptions: ["Wall studs are accessible"],
      },
    );
    expect(merged[0]).toBe("From your description: Mount a 55-inch TV on a drywall living-room wall");
    expect(merged).toContain("Wall studs are accessible");
    expect(merged.some((note) => /supplies the TV/i.test(note))).toBe(true);
  });

  it("keeps a generic note that does not name another service", () => {
    expect(noteFitsService("paint", "Price shown is a firm quote for the scope described")).toBe(true);
    expect(noteFitsService("helper", "Repaint the bedroom walls")).toBe(false);
  });
});
