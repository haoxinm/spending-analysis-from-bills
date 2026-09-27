import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SpendQueryParams } from "@/hooks/use-spend-query-params";

import { FiltersBar } from "./filters";
import type { Category } from "./types";

const CATEGORIES: Category[] = [
  { key: "groceries", name: "Groceries", subcategories: [] },
  { key: "dining", name: "Dining", subcategories: [] },
];

function baseFilters(): SpendQueryParams {
  return {};
}

describe("FiltersBar", () => {
  it("toggles a kind filter immediately (no debounce)", async () => {
    const onChange = vi.fn();
    render(<FiltersBar filters={baseFilters()} categories={CATEGORIES} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "purchase" }));

    expect(onChange).toHaveBeenCalledWith({ kinds: ["purchase"] });
  });

  it("toggles a category filter immediately", async () => {
    const onChange = vi.fn();
    render(<FiltersBar filters={baseFilters()} categories={CATEGORIES} onChange={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: "Groceries" }));

    expect(onChange).toHaveBeenCalledWith({ categoryKeys: ["groceries"] });
  });

  it("un-toggles a kind that is already selected", async () => {
    const onChange = vi.fn();
    render(
      <FiltersBar filters={{ kinds: ["purchase"] }} categories={CATEGORIES} onChange={onChange} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "purchase" }));

    expect(onChange).toHaveBeenCalledWith({ kinds: undefined });
  });

  it("debounces the search box", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const onChange = vi.fn();
    render(<FiltersBar filters={baseFilters()} categories={CATEGORIES} onChange={onChange} />);

    await userEvent.type(screen.getByLabelText("Search"), "coffee", {
      advanceTimers: (ms) => vi.advanceTimersByTime(ms),
    });

    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledWith({ search: "coffee" });
    vi.useRealTimers();
  });

  it("shows a Clear filters button only once a filter is active", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FiltersBar filters={baseFilters()} categories={CATEGORIES} onChange={onChange} />,
    );
    expect(screen.queryByText("Clear filters")).not.toBeInTheDocument();

    rerender(
      <FiltersBar filters={{ search: "coffee" }} categories={CATEGORIES} onChange={onChange} />,
    );
    expect(screen.getByText("Clear filters")).toBeInTheDocument();
  });
});
