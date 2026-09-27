import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DateRangePicker, type DateRange } from "./date-range-picker";

describe("DateRangePicker", () => {
  it("calls onChange with both bounds when a preset is clicked", async () => {
    const onChange = vi.fn<(next: DateRange) => void>();
    render(<DateRangePicker value={{ from: null, to: null }} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "This year" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls.at(0)?.[0];
    expect(arg?.from).toMatch(/^\d{4}-01-01$/);
    expect(arg?.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("updates the 'from' field directly", () => {
    const onChange = vi.fn();
    render(<DateRangePicker value={{ from: null, to: null }} onChange={onChange} />);

    const input = screen.getByLabelText("Date from");
    fireEvent.change(input, { target: { value: "2025-01-01" } });

    expect(onChange).toHaveBeenCalledWith({ from: "2025-01-01", to: null });
  });

  it("hides presets when hidePresets is set", () => {
    render(
      <DateRangePicker value={{ from: null, to: null }} onChange={vi.fn()} hidePresets />,
    );
    expect(screen.queryByRole("group", { name: "Date range presets" })).not.toBeInTheDocument();
  });
});
