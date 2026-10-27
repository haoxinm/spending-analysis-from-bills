import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { YearPicker } from "./year-picker";

describe("YearPicker", () => {
  it("has a roving tabindex on the selected year", () => {
    render(
      <YearPicker years={[2024, 2023, 2022]} value={2023} onChange={vi.fn()} />,
    );
    expect(screen.getByRole("radio", { name: "2023" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("radio", { name: "2024" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByRole("radio", { name: "2022" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });
  it("moves selection with arrow keys, wrapping", () => {
    const onChange = vi.fn();
    render(
      <YearPicker
        years={[2024, 2023, 2022]}
        value={2022}
        onChange={onChange}
      />,
    );
    fireEvent.keyDown(screen.getByRole("radio", { name: "2022" }), {
      key: "ArrowRight",
    });
    expect(onChange).toHaveBeenLastCalledWith(2024);
    fireEvent.keyDown(screen.getByRole("radio", { name: "2022" }), {
      key: "ArrowLeft",
    });
    expect(onChange).toHaveBeenLastCalledWith(2023);
  });
  it("shows a focus-visible ring", () => {
    render(<YearPicker years={[2024]} value={2024} onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "2024" }).className).toMatch(
      /focus-visible:ring-2/,
    );
  });
});
