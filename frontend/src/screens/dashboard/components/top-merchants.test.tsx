import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { TopMerchantRow } from "../logic";
import { TopMerchants } from "./top-merchants";

const ROWS: TopMerchantRow[] = [
  { merchant: "hardware supply co", total_minor: 9250, txn_count: 1 },
  { merchant: "grocery mart", total_minor: 4500, txn_count: 1 },
];

/** Regression coverage: `merchant` is the raw, lowercase `merchant_key` — shown title-cased for
 * readability, with the untouched key kept as a `title` tooltip so nothing is actually lost. */
describe("TopMerchants", () => {
  it("shows a title-cased display name with the raw key as a tooltip", () => {
    render(<TopMerchants rows={ROWS} currency="USD" />);

    const label = screen.getByText("Hardware Supply Co");
    expect(label).toBeInTheDocument();
    expect(label).toHaveAttribute("title", "hardware supply co");
    expect(screen.getByText("Grocery Mart")).toBeInTheDocument();
  });

  it("shows an empty state with no rows", () => {
    render(<TopMerchants rows={[]} currency="USD" />);
    expect(screen.getByText("No merchants yet")).toBeInTheDocument();
  });
});
