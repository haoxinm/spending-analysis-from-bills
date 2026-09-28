import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Money } from "./money";

describe("Money", () => {
  it("renders a positive amount (outflow) with no sign", () => {
    render(<Money minorUnits={1234} />);
    const el = screen.getByText("$12.34");
    expect(el).toHaveAttribute("data-direction", "outflow");
    expect(el.className).toContain("tabular-nums");
    expect(el.className).toContain("text-outflow");
  });

  it("renders a negative amount (inflow) as clearly negative", () => {
    render(<Money minorUnits={-1234} />);
    const el = screen.getByText("-$12.34");
    expect(el).toHaveAttribute("data-direction", "inflow");
    expect(el.className).toContain("text-inflow");
  });

  it("renders zero distinctly from both directions", () => {
    render(<Money minorUnits={0} />);
    const el = screen.getByText("$0.00");
    expect(el).toHaveAttribute("data-direction", "zero");
  });

  it("replaces the minus with a leading + for inflow when showPlusForInflow is set", () => {
    render(<Money minorUnits={-500} showPlusForInflow />);
    expect(screen.getByText("+$5.00")).toBeInTheDocument();
  });

  it("never flips the raw sign, even with showPlusForInflow on an outflow", () => {
    render(<Money minorUnits={500} showPlusForInflow />);
    expect(screen.getByText("$5.00")).toBeInTheDocument();
  });

  it("exposes the direction via aria-label for screen readers", () => {
    render(<Money minorUnits={999} />);
    expect(screen.getByText("$9.99")).toHaveAttribute("aria-label", "outflow $9.99");
  });
});
