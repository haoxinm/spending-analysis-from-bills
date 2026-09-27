import { describe, expect, it } from "vitest";

import { generateSyntheticFixture } from "./fixture";
import { emptySpec } from "./spec-types";

describe("generateSyntheticFixture", () => {
  it("never includes any real-looking bank name and always fabricates data", () => {
    const spec = emptySpec();
    spec.id = "user_acme_credit";
    spec.columns = [
      { name: "posted_date", x0: 0, x1: 10, type: "date", formats: ["%m/%d"] },
      { name: "description", x0: 12, x1: 60, type: "text", multiline: true },
      { name: "amount", x0: 62, x1: 80, type: "money" },
    ];
    const text = generateSyntheticFixture(spec, "id: user_acme_credit\n");

    expect(text).toContain("Synthetic fixture");
    expect(text).toContain("EXAMPLE MERCHANT");
    expect(text).toContain("spec.yaml");
    expect(text).toContain("fixture.txt");
    expect(text).not.toMatch(/chase|bank of america|wells fargo|citi/i);
  });

  it("places synthetic values roughly under each column's x-band", () => {
    const spec = emptySpec();
    spec.columns = [
      { name: "posted_date", x0: 0, x1: 5, type: "date", formats: ["%m/%d"] },
      { name: "description", x0: 10, x1: 40, type: "text" },
      { name: "amount", x0: 50, x1: 60, type: "money" },
    ];
    const text = generateSyntheticFixture(spec, "id: x\n");
    const fixtureSection = text.split("--- fixture.txt ---")[1] ?? "";
    const firstRow = fixtureSection.split("\n").find((l) => l.includes("EXAMPLE MERCHANT"));
    expect(firstRow).toBeDefined();
  });
});
