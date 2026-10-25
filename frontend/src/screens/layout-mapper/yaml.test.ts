import { describe, expect, it } from "vitest";

import type { LayoutSpecObject } from "./spec-types";
import { parseYamlish, stringifySpec, YamlParseError } from "./yaml";

const PLAN_EXAMPLE = `
id: user_acme_credit
version: 1
detect:
  all_of: ["ACCOUNT ACTIVITY"]
  any_of: ["Merchant Name or Transaction Description"]
  score: 0.85
columns:
  - {name: posted_date,     x0: 52,  x1: 110, type: date,  formats: ["%m/%d"]}
  - {name: description,     x0: 110, x1: 420, type: text,  multiline: true}
  - {name: issuer_category, x0: 420, x1: 500, type: text,  optional: true}
  - {name: amount,          x0: 500, x1: 560, type: money}
sections:
  mode: heading
  patterns:
    - {match: "PAYMENTS AND OTHER CREDITS", kind_hint: payment_or_refund}
    - {match: "PURCHASES",                  kind_hint: purchase}
  terminator: "^TOTAL .* FOR THIS PERIOD$"
  exclude_tables: ["INTEREST CHARGED"]
sign: {outflow: unsigned, inflow: leading_minus}
year_inference: from_period
totals: {section_totals: true}
account_type: credit
`;

describe("parseYamlish", () => {
  it("parses the plan's §P1-H example spec", () => {
    const data = parseYamlish(PLAN_EXAMPLE) as Record<string, unknown>;
    expect(data.id).toBe("user_acme_credit");
    expect(data.version).toBe(1);
    expect(data.account_type).toBe("credit");

    const detect = data.detect as Record<string, unknown>;
    expect(detect.all_of).toEqual(["ACCOUNT ACTIVITY"]);
    expect(detect.score).toBe(0.85);

    const columns = data.columns as Array<Record<string, unknown>>;
    expect(columns).toHaveLength(4);
    expect(columns[0]).toEqual({ name: "posted_date", x0: 52, x1: 110, type: "date", formats: ["%m/%d"] });
    expect(columns[2]).toEqual({ name: "issuer_category", x0: 420, x1: 500, type: "text", optional: true });

    const sections = data.sections as Record<string, unknown>;
    expect(sections.mode).toBe("heading");
    expect((sections.patterns as unknown[]).length).toBe(2);
    expect(sections.terminator).toBe("^TOTAL .* FOR THIS PERIOD$");
    expect(sections.exclude_tables).toEqual(["INTEREST CHARGED"]);

    expect(data.sign).toEqual({ outflow: "unsigned", inflow: "leading_minus" });
    expect(data.totals).toEqual({ section_totals: true });
  });

  it("parses plain JSON directly", () => {
    const json = JSON.stringify({ id: "x", version: 1 });
    expect(parseYamlish(json)).toEqual({ id: "x", version: 1 });
  });

  it("ignores comments and blank lines", () => {
    const text = `
# a comment
id: x  # trailing comment
version: 1

`;
    expect(parseYamlish(text)).toEqual({ id: "x", version: 1 });
  });

  it("throws YamlParseError on malformed flow", () => {
    expect(() => parseYamlish("columns:\n  - {name: x, x0: 1")).toThrow(YamlParseError);
  });
});

describe("stringifySpec / parseYamlish round trip", () => {
  it("round-trips a full spec object", () => {
    const spec: LayoutSpecObject = {
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
      account_mask: { pattern: "ending in (\\d{4})" },
      fx: { pattern: "FOREIGN CURRENCY AMOUNT (\\d+\\.\\d+) (\\w{3})", amount_group: 1, currency_group: 2, rate_group: "rate" },
    };

    const yamlText = stringifySpec(spec);
    const parsed = parseYamlish(yamlText);
    expect(parsed).toEqual(spec);
  });
});
