import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { MonthOverMonthDelta } from "../logic";
import { MonthOverMonth } from "./month-over-month";

function delta(overrides: Partial<MonthOverMonthDelta>): MonthOverMonthDelta {
  return {
    currentPeriod: "2026-02",
    previousPeriod: "2026-01",
    currentMinor: 5195,
    previousMinor: 15000,
    deltaMinor: -9805,
    deltaPct: -0.6537,
    ...overrides,
  };
}

/**
 * Regression coverage for a real bug: the arrow, the delta's sign and the percentage used to
 * disagree on a decrease — e.g. a down arrow (good news) next to "+$98.05" (`showPlusForInflow`
 * always put a `+` in front of a negative delta) next to "(-65.4%)". Every case below asserts
 * the arrow, the sign and the percentage all read the same direction.
 */
describe("MonthOverMonth", () => {
  it("reads a decrease as good news throughout: down arrow, minus sign, negative percentage", () => {
    render(<MonthOverMonth delta={delta({})} currency="USD" />);

    expect(screen.getByText("▼")).toBeInTheDocument();
    expect(screen.getByText(/^-\$98\.05$/)).toBeInTheDocument();
    expect(screen.getByText(/\(-65\.4%\)/)).toBeInTheDocument();
    // The arrow and the amount share one "this is good" colour class.
    expect(screen.getByText("▼").className).toContain("text-inflow");
  });

  it("reads an increase as bad news throughout: up arrow, no minus, positive percentage", () => {
    render(
      <MonthOverMonth
        delta={delta({
          currentMinor: 15000,
          previousMinor: 5195,
          deltaMinor: 9805,
          deltaPct: 0.6537,
        })}
        currency="USD"
      />,
    );

    expect(screen.getByText("▲")).toBeInTheDocument();
    expect(screen.getByText(/^\$98\.05$/)).toBeInTheDocument();
    expect(screen.getByText(/\(65\.4%\)/)).toBeInTheDocument();
    expect(screen.getByText("▲").className).toContain("text-outflow");
  });

  it("shows an empty state with fewer than two periods", () => {
    render(<MonthOverMonth delta={null} currency="USD" />);
    expect(screen.getByText("Not enough history yet")).toBeInTheDocument();
  });
});
