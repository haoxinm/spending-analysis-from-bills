import { render, screen, within } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({ data }: { data: unknown[] }) => <div data-testid="mock-pie" data-count={data.length} />,
  Cell: () => null,
  Tooltip: () => null,
}));

const { IncomeBreakdown } = await import("./income-breakdown");
const { summary } = await import("../test-fixtures");

describe("IncomeBreakdown with a net capital loss", () => {
  const s = summary({
    income_by_category: [
      { category: "salary_wages", label: "Wages and salary", amount_minor: 900000, is_memo: false },
      { category: "interest", label: "Interest", amount_minor: 100000, is_memo: false },
      { category: "long_term_capital_gain", label: "Long-term capital gains", amount_minor: -300000, is_memo: false },
    ],
    total_income_minor: 700000,
  });

  it("shows the negative row with a minus sign and an em dash share, and keeps it out of the donut", () => {
    render(<IncomeBreakdown summary={s} />);
    expect(screen.getByTestId("mock-pie")).toHaveAttribute("data-count", "2");
    const row = screen.getByText("Long-term capital gains").closest("tr")!;
    expect(within(row).getByText("-$3,000.00")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();
    const wages = screen.getByText("Wages and salary").closest("tr")!;
    expect(within(wages).getByText("90%")).toBeInTheDocument();
    expect(screen.getByText("Total income").closest("tr")).toHaveTextContent("$7,000.00");
  });
});
