import { describe, expect, it } from "vitest";

import {
  computeMonthOverMonthDelta,
  detectOtherCurrencies,
  distinctCategories,
  humanizeMerchantKey,
  pivotByCategory,
  toTrendPoints,
  totalsByUser,
  type AnalyticsRow,
} from "./logic";

function row(overrides: Partial<AnalyticsRow>): AnalyticsRow {
  return {
    period: null,
    category: null,
    subcategory: null,
    user: null,
    account: null,
    merchant: null,
    currency: "USD",
    total_minor: 0,
    txn_count: 0,
    avg_minor: 0,
    ...overrides,
  };
}

describe("pivotByCategory", () => {
  it("groups rows by period, summing each category within a period", () => {
    const rows = [
      row({ period: "2025-01", category: "groceries", total_minor: 1000 }),
      row({ period: "2025-01", category: "dining", total_minor: 500 }),
      row({ period: "2025-01", category: "groceries", total_minor: 200 }),
      row({ period: "2025-02", category: "groceries", total_minor: 300 }),
    ];

    const points = pivotByCategory(rows);

    expect(points).toEqual([
      { period: "2025-01", categories: { groceries: 1200, dining: 500 }, totalMinor: 1700 },
      { period: "2025-02", categories: { groceries: 300 }, totalMinor: 300 },
    ]);
  });

  it("sorts periods chronologically (lexical order on zero-padded period keys)", () => {
    const rows = [
      row({ period: "2025-03", category: "a", total_minor: 1 }),
      row({ period: "2025-01", category: "a", total_minor: 1 }),
      row({ period: "2025-02", category: "a", total_minor: 1 }),
    ];

    expect(pivotByCategory(rows).map((p) => p.period)).toEqual(["2025-01", "2025-02", "2025-03"]);
  });

  it("falls back to 'uncategorized' rather than dropping a row with no category", () => {
    const rows = [row({ period: "2025-01", category: null, total_minor: 500 })];
    const points = pivotByCategory(rows);
    expect(points[0]?.categories).toEqual({ uncategorized: 500 });
  });

  it("returns an empty array for no rows", () => {
    expect(pivotByCategory([])).toEqual([]);
  });
});

describe("distinctCategories", () => {
  it("collects every category key across points, sorted", () => {
    const points = pivotByCategory([
      row({ period: "2025-01", category: "dining", total_minor: 1 }),
      row({ period: "2025-02", category: "groceries", total_minor: 1 }),
    ]);
    expect(distinctCategories(points)).toEqual(["dining", "groceries"]);
  });
});

describe("toTrendPoints", () => {
  it("sums total_minor per period, ignoring other group keys, sorted chronologically", () => {
    const rows = [
      row({ period: "2025-02", total_minor: 100 }),
      row({ period: "2025-01", total_minor: 200 }),
      row({ period: "2025-01", total_minor: 50 }),
    ];
    expect(toTrendPoints(rows)).toEqual([
      { period: "2025-01", totalMinor: 250 },
      { period: "2025-02", totalMinor: 100 },
    ]);
  });
});

describe("computeMonthOverMonthDelta", () => {
  it("returns null with fewer than two periods", () => {
    expect(computeMonthOverMonthDelta([])).toBeNull();
    expect(computeMonthOverMonthDelta([{ period: "2025-01", totalMinor: 100 }])).toBeNull();
  });

  it("computes the delta between the two most recent periods", () => {
    const delta = computeMonthOverMonthDelta([
      { period: "2025-01", totalMinor: 100 },
      { period: "2025-02", totalMinor: 150 },
    ]);
    expect(delta).toEqual({
      currentPeriod: "2025-02",
      previousPeriod: "2025-01",
      currentMinor: 150,
      previousMinor: 100,
      deltaMinor: 50,
      deltaPct: 0.5,
    });
  });

  it("handles a decrease", () => {
    const delta = computeMonthOverMonthDelta([
      { period: "2025-01", totalMinor: 200 },
      { period: "2025-02", totalMinor: 100 },
    ]);
    expect(delta?.deltaMinor).toBe(-100);
    expect(delta?.deltaPct).toBeCloseTo(-0.5);
  });

  it("returns a null percentage when the previous period totalled zero", () => {
    const delta = computeMonthOverMonthDelta([
      { period: "2025-01", totalMinor: 0 },
      { period: "2025-02", totalMinor: 100 },
    ]);
    expect(delta?.deltaPct).toBeNull();
    expect(delta?.deltaMinor).toBe(100);
  });

  it("sorts out-of-order input before picking the two most recent", () => {
    const delta = computeMonthOverMonthDelta([
      { period: "2025-03", totalMinor: 300 },
      { period: "2025-01", totalMinor: 100 },
      { period: "2025-02", totalMinor: 200 },
    ]);
    expect(delta?.currentPeriod).toBe("2025-03");
    expect(delta?.previousPeriod).toBe("2025-02");
  });
});

describe("totalsByUser", () => {
  it("sums total_minor per user, ranked highest first", () => {
    const rows = [
      row({ user: 1, total_minor: 100 }),
      row({ user: 2, total_minor: 500 }),
      row({ user: 1, total_minor: 50 }),
    ];
    expect(totalsByUser(rows)).toEqual([
      { userId: 2, totalMinor: 500 },
      { userId: 1, totalMinor: 150 },
    ]);
  });

  it("drops rows with no user", () => {
    const rows = [row({ user: null, total_minor: 100 }), row({ user: 1, total_minor: 50 })];
    expect(totalsByUser(rows)).toEqual([{ userId: 1, totalMinor: 50 }]);
  });
});

describe("humanizeMerchantKey", () => {
  it("title-cases a lowercase, multi-word merchant key", () => {
    expect(humanizeMerchantKey("hardware supply co")).toBe("Hardware Supply Co");
  });

  it("leaves a single word capitalized", () => {
    expect(humanizeMerchantKey("netflix")).toBe("Netflix");
  });

  it("collapses repeated whitespace", () => {
    expect(humanizeMerchantKey("garden   center")).toBe("Garden Center");
  });

  it("handles an empty string", () => {
    expect(humanizeMerchantKey("")).toBe("");
  });
});

describe("detectOtherCurrencies", () => {
  it("returns currencies other than the selected one, sorted, deduplicated", () => {
    const accounts = [{ currency: "USD" }, { currency: "EUR" }, { currency: "EUR" }, { currency: "GBP" }];
    expect(detectOtherCurrencies(accounts, "USD")).toEqual(["EUR", "GBP"]);
  });

  it("returns an empty array when every account matches the selected currency", () => {
    expect(detectOtherCurrencies([{ currency: "USD" }, { currency: "USD" }], "USD")).toEqual([]);
  });

  it("returns an empty array with no accounts", () => {
    expect(detectOtherCurrencies([], "USD")).toEqual([]);
  });
});
