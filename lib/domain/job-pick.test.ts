import { describe, expect, it } from "vitest";
import { jobLine } from "@/lib/domain/job-pick";

describe("a job in the crew's pick list", () => {
  it("shows the work and the street", () => {
    expect(jobLine({ id: "1", scope: "Paint the great room", where: "412 Oak St, Cadillac, MI 49601", when: "" })).toBe("Paint the great room · 412 Oak St");
  });

  it("shortens long work and copes with no address", () => {
    const long = jobLine({ id: "1", scope: "Paint the great room, the hallway, both bedrooms and the stairwell", where: "", when: "" });
    expect(long.length).toBe(44);
    expect(long.endsWith("…")).toBe(true);
  });
});
