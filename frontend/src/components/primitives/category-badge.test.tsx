import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CategoryBadge } from "./category-badge";

describe("CategoryBadge", () => {
  it("title-cases the category key when no label is given", () => {
    render(<CategoryBadge categoryKey="dining-out" />);
    expect(screen.getByText("Dining Out")).toBeInTheDocument();
  });

  it("shows the subcategory alongside the category", () => {
    render(<CategoryBadge categoryKey="dining" subcategoryLabel="restaurants" />);
    expect(screen.getByText(/restaurants/)).toBeInTheDocument();
  });

  it("shows a compact, single-line review badge when flagged", () => {
    render(<CategoryBadge categoryKey="transport" needsReview />);
    const reviewBadge = screen.getByText("Review");
    expect(reviewBadge).toBeInTheDocument();
    expect(reviewBadge).toHaveAttribute("title", "Needs review");
    expect(reviewBadge.className).toContain("whitespace-nowrap");
  });

  it("assigns the same colour class to the same key every render", () => {
    const { unmount: unmountA } = render(<CategoryBadge categoryKey="groceries" />);
    const classesA = screen.getByText("Groceries").className;
    unmountA();
    render(<CategoryBadge categoryKey="groceries" />);
    const classesB = screen.getByText("Groceries").className;
    expect(classesA).toBe(classesB);
  });
});
