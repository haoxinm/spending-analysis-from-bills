import { render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import type { AnalyticsRow } from "../logic";

// See `category-stacked-bar.test.tsx` for why the whole module is stubbed rather than only
// `Line`: every Recharts element here shares a chart-layout context a real `LineChart`
// establishes, which a partial mock can't provide.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ data, children }: { data: unknown; children: React.ReactNode }) => (
    <div data-testid="mock-linechart" data-chart={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Line: (props: { dataKey: string; isAnimationActive?: boolean }) => (
    <div data-testid="mock-line" data-animation-active={String(props.isAnimationActive)} />
  ),
  CartesianGrid: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const { TrendLine } = await import("./trend-line");

const ROWS: AnalyticsRow[] = [
  { period: "2026-01", currency: "USD", total_minor: 15000, txn_count: 3, avg_minor: 5000 },
  { period: "2026-02", currency: "USD", total_minor: 5195, txn_count: 2, avg_minor: 2597 },
];

/**
 * Regression coverage for a real bug: Recharts' default line-draw animation reveals the path via
 * `stroke-dasharray` over ~1.5s, so right after mounting the line read as a short stub rather
 * than the full trend until that settled. Fixed by `isAnimationActive={false}` in
 * `trend-line.tsx`.
 */
describe("TrendLine", () => {
  it("feeds the chart every period's exact total, with animation disabled", () => {
    render(<TrendLine rows={ROWS} currency="USD" />);

    const chart = screen.getByTestId("mock-linechart");
    const data = JSON.parse(chart.getAttribute("data-chart")!) as Record<string, unknown>[];
    expect(data).toEqual([
      { period: "2026-01", totalMinor: 15000 },
      { period: "2026-02", totalMinor: 5195 },
    ]);

    expect(screen.getByTestId("mock-line")).toHaveAttribute("data-animation-active", "false");
  });

  it("shows an empty state with no rows", () => {
    render(<TrendLine rows={[]} currency="USD" />);
    expect(screen.getByText("No trend yet")).toBeInTheDocument();
  });
});
