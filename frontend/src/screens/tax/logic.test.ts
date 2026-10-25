import { describe, expect, it } from "vitest";

import {
  basisNotice,
  formatRate,
  formTypeLabel,
  groupPayers,
  headlineTax,
  incomeBasisLabel,
  refundOrOwed,
  resolveYear,
  taxBreakdownRows,
  toIncomeBars,
  yearOverYear,
} from "./logic";
import { PAYERS, summary } from "./test-fixtures";

describe("formatRate", () => {
  it("formats fractions as percentages and null as a dash", () => {
    expect(formatRate(0.1319)).toBe("13.19%");
    expect(formatRate(0)).toBe("0.00%");
    expect(formatRate(null)).toBe("—");
  });
});

describe("labels", () => {
  it("labels bases and forms", () => {
    expect(incomeBasisLabel("mixed")).toMatch(/mixed/i);
    expect(basisNotice("source_documents")).toBeNull();
    expect(basisNotice("return")).toMatch(/1040/);
    expect(formTypeLabel("1099-div")).toBe("1099-DIV");
    expect(formTypeLabel("weird")).toBe("weird");
  });
});

describe("toIncomeBars", () => {
  it("drops memo and zero categories", () => {
    const bars = toIncomeBars(summary());
    expect(bars.map((b) => b.category)).toEqual(["salary_wages", "interest", "ordinary_dividends"]);
    expect(bars.reduce((s, b) => s + b.value, 0)).toBe(10974260 + 24000 + 290000);
  });
});

describe("headlineTax", () => {
  it("uses federal liability plus FICA plus withheld state when no state liability", () => {
    const t = headlineTax(summary());
    expect(t).toMatchObject({ federalMinor: 1489100, federalKind: "liability", ficaMinor: 863244, stateMinor: 500000 });
    expect(t.totalMinor).toBe(1489100 + 863244 + 500000);
  });
  it("falls back to withheld federal tax without a return", () => {
    const t = headlineTax(summary({ liability: [] }));
    expect(t.federalKind).toBe("withheld");
    expect(t.federalMinor).toBe(1423040);
  });
});

describe("refundOrOwed", () => {
  it("classifies", () => {
    expect(refundOrOwed(summary())).toMatchObject({ kind: "refund", amountMinor: 30000 });
    expect(refundOrOwed(summary({ refund_minor: 0, amount_owed_minor: 500 }))).toMatchObject({ kind: "owed", amountMinor: 500 });
    expect(refundOrOwed(summary({ refund_minor: null, amount_owed_minor: null })).kind).toBe("unknown");
    expect(refundOrOwed(summary({ refund_minor: 0, amount_owed_minor: 0 })).kind).toBe("even");
  });
});

describe("taxBreakdownRows", () => {
  it("groups rows and flags estimates", () => {
    const groups = taxBreakdownRows(summary());
    expect(groups.map((g) => g.key)).toEqual(["withholding", "fica", "liability", "payments", "result"]);
    const liability = groups.find((g) => g.key === "liability")!;
    expect(liability.rows.filter((r) => r.estimate).map((r) => r.key)).toEqual([
      "federal_tax_ordinary_est",
      "federal_tax_preferential_est",
    ]);
    const niit = liability.rows.find((r) => r.key === "net_investment_income_tax");
    expect(niit?.amountMinor).toBeNull();
    expect(liability.rows.some((r) => r.key === "self_employment_tax")).toBe(false);
  });
  it("reports unknown result and payments when there is no return", () => {
    const groups = taxBreakdownRows(
      summary({ liability: [], payments_minor: null, refund_minor: null, amount_owed_minor: null }),
    );
    expect(groups.find((g) => g.key === "payments")!.rows[0]!.amountMinor).toBeNull();
    expect(groups.find((g) => g.key === "result")!.rows[0]!.missingText).toBe("unknown");
  });
});

describe("yearOverYear / groupPayers / resolveYear", () => {
  it("orders years ascending", () => {
    const pts = yearOverYear([summary({ tax_year: 2024 }), summary({ tax_year: 2023, total_income_minor: 5 })]);
    expect(pts.map((p) => p.year)).toEqual([2023, 2024]);
    expect(pts[0]!.income).toBe(5);
  });
  it("groups payers for a year, largest first", () => {
    const rows = groupPayers([...PAYERS, { ...PAYERS[0]!, tax_year: 2023 }], 2024);
    expect(rows.map((r) => r.payerName)).toEqual(["Pinecrest Logistics LLC", "Harbor Bank"]);
    expect(groupPayers([{ ...PAYERS[0]!, payer_name: null }], 2024)[0]!.payerName).toBe("Unknown payer");
  });
  it("resolves the year", () => {
    expect(resolveYear(2023, [2024, 2023])).toBe(2023);
    expect(resolveYear(2020, [2024, 2023])).toBe(2024);
    expect(resolveYear(null, [])).toBeNull();
  });
});
