import { describe, expect, it } from "vitest";

import { emptySpec, type LayoutSpecObject } from "./spec-types";
import { validateSpec } from "./spec-validate";

function validSpec(): LayoutSpecObject {
  return {
    id: "user_acme_credit",
    version: 1,
    account_type: "credit",
    currency: "USD",
    detect: { all_of: ["ACCOUNT ACTIVITY"], any_of: [], score: 0.85 },
    columns: [
      { name: "posted_date", x0: 52, x1: 110, type: "date", formats: ["%m/%d"] },
      { name: "description", x0: 110, x1: 420, type: "text", multiline: true },
      { name: "amount", x0: 500, x1: 560, type: "money" },
    ],
    sections: {
      mode: "heading",
      patterns: [{ match: "PURCHASES", kind_hint: "purchase" }],
      terminator: "^TOTAL$",
      exclude_tables: ["INTEREST CHARGED"],
    },
    sign: { outflow: "unsigned", inflow: "leading_minus" },
    year_inference: "from_period",
    totals: { section_totals: true },
  };
}

describe("validateSpec", () => {
  it("accepts a well-formed spec", () => {
    expect(validateSpec(validSpec())).toEqual([]);
  });

  it("accepts the manual builder's empty starting spec once given an id and bands", () => {
    const spec = emptySpec();
    spec.id = "user_acme_credit";
    spec.columns = spec.columns.map((c, i) => ({ ...c, x0: i * 100, x1: i * 100 + 50 }));
    expect(validateSpec(spec)).toEqual([]);
  });

  it("rejects a non-object", () => {
    expect(validateSpec("nope")).toEqual([{ field: "<root>", message: "must be a mapping (object)" }]);
  });

  it("rejects a bad id", () => {
    const spec = validSpec();
    spec.id = "Not Snake Case";
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.field === "id")).toBe(true);
  });

  it("requires posted_date and description columns", () => {
    const spec = validSpec();
    spec.columns = [{ name: "amount", x0: 0, x1: 10, type: "money" }];
    const errors = validateSpec(spec);
    expect(errors.map((e) => e.message)).toContain("a 'posted_date' column is required");
    expect(errors.map((e) => e.message)).toContain("a 'description' column is required");
  });

  it("requires at least one money column", () => {
    const spec = validSpec();
    spec.columns = spec.columns.filter((c) => c.type !== "money");
    const errors = validateSpec(spec);
    expect(errors.map((e) => e.message)).toContain("at least one money column is required");
  });

  it("rejects mixing an amount column with debit/credit columns", () => {
    const spec = validSpec();
    spec.columns.push({ name: "debit", x0: 560, x1: 600, type: "money", role: "debit" });
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.message.includes("cannot mix"))).toBe(true);
  });

  it("rejects duplicate column names", () => {
    const spec = validSpec();
    spec.columns.push({ ...spec.columns[0]! });
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.message.includes("duplicate column name"))).toBe(true);
  });

  it("requires a date column to declare formats", () => {
    const spec = validSpec();
    spec.columns[0] = { name: "posted_date", x0: 0, x1: 10, type: "date" };
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.field === "columns[0].formats")).toBe(true);
  });

  it("rejects x0 >= x1", () => {
    const spec = validSpec();
    spec.columns[0]!.x0 = 100;
    spec.columns[0]!.x1 = 50;
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.field === "columns[0]" && e.message.includes("must be less than"))).toBe(true);
  });

  it("rejects an overlong regex pattern", () => {
    const spec = validSpec();
    spec.sections!.terminator = "x".repeat(300);
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.field === "sections.terminator")).toBe(true);
  });

  it("rejects a catastrophically backtracking regex", () => {
    const spec = validSpec();
    spec.sections!.terminator = "(a+)+$";
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.field === "sections.terminator" && e.message.includes("nested quantifiers"))).toBe(
      true,
    );
  });

  it("rejects an invalid regex", () => {
    const spec = validSpec();
    spec.sections!.terminator = "(unclosed";
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.field === "sections.terminator" && e.message.includes("invalid regex"))).toBe(true);
  });

  it("requires a section pattern to declare a kind hint", () => {
    const spec = validSpec();
    spec.sections!.patterns = [{ match: "PURCHASES" }];
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.message.includes("kind_hint"))).toBe(true);
  });

  it("validates fx group fields", () => {
    const spec = validSpec();
    (spec as unknown as Record<string, unknown>).fx = {
      pattern: "FOREIGN CURRENCY AMOUNT (\\d+\\.\\d+) (\\w{3})",
      amount_group: 0,
      currency_group: "",
      rate_group: "rate",
    };
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.field === "fx.amount_group")).toBe(true);
    expect(errors.some((e) => e.field === "fx.currency_group")).toBe(true);
    expect(errors.some((e) => e.field === "fx.rate_group")).toBe(false);
  });

  it("validates account_mask.pattern", () => {
    const spec = validSpec();
    (spec as unknown as Record<string, unknown>).account_mask = { pattern: "" };
    const errors = validateSpec(spec);
    expect(errors.some((e) => e.field === "account_mask.pattern")).toBe(true);
  });
});
