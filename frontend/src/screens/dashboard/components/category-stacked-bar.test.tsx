import { render, screen } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import type { AnalyticsRow } from "../logic";

// Rendering a real Recharts `<BarChart>` through jsdom needs SVG text-measurement APIs jsdom
// doesn't implement, which makes pixel-geometry assertions on it flaky for reasons unrelated to
// this component's own logic. Every Recharts element this component uses establishes or reads a
// chart-layout React context internally, so a partial mock (stubbing only `Bar`, say) throws —
// stubbing the whole module instead asserts exactly the two things that matter and used to be
// wrong — the *data* each `<Bar>` is fed, and that it renders immediately rather than animating
// in — deterministically, with no SVG layout involved.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ data, children }: { data: unknown; children: React.ReactNode }) => (
    <div data-testid="mock-barchart" data-chart={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Bar: (props: { dataKey: string; isAnimationActive?: boolean }) => (
    <div
      data-testid="mock-bar"
      data-key={props.dataKey}
      data-animation-active={String(props.isAnimationActive)}
    />
  ),
  CartesianGrid: () => null,
  Legend: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const { CategoryStackedBar } = await import("./category-stacked-bar");

const ROWS: AnalyticsRow[] = [
  { period: "2026-01", category: "others", currency: "USD", total_minor: 15000, txn_count: 3, avg_minor: 5000 },
  { period: "2026-02", category: "others", currency: "USD", total_minor: 5195, txn_count: 2, avg_minor: 2597 },
];

/**
 * Regression coverage for a real bug: Recharts' default entrance animation grows each bar from
 * zero over ~1.5s, so a bar's rendered height only matched its real value once that settled — a
 * screenshot, or a person glancing at the screen right after a same-session navigation, could
 * (and did) see a materially wrong total: a ~$86 bar for what should have read $150.00. Fixed by
 * `isAnimationActive={false}` in `category-stacked-bar.tsx`.
 */
describe("CategoryStackedBar", () => {
  it("feeds the chart each period's exact total, in minor units, with animation disabled", () => {
    render(<CategoryStackedBar rows={ROWS} currency="USD" />);

    const chart = screen.getByTestId("mock-barchart");
    const data = JSON.parse(chart.getAttribute("data-chart")!) as Record<string, unknown>[];
    expect(data).toEqual([
      { period: "2026-01", others: 15000 },
      { period: "2026-02", others: 5195 },
    ]);

    for (const bar of screen.getAllByTestId("mock-bar")) {
      expect(bar).toHaveAttribute("data-animation-active", "false");
    }
  });

  it("shows an empty state with no rows", () => {
    render(<CategoryStackedBar rows={[]} currency="USD" />);
    expect(screen.getByText("No spending yet")).toBeInTheDocument();
  });
});
