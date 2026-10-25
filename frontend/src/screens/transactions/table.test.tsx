import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Category, Transaction } from "./types";
import { TransactionsTable } from "./table";

const CATEGORIES: Category[] = [];

const TRANSACTIONS: Transaction[] = [
  {
    id: 1,
    statement_id: 1,
    account_id: 1,
    posted_date: "2026-02-05",
    transaction_date: null,
    description_raw: "GARDEN CENTER",
    description_clean: "GARDEN CENTER",
    amount_minor: 1820,
    currency: "USD",
    kind: "purchase",
    category_key: "others",
    subcategory_key: "uncategorized",
    merchant_key: "garden center",
    notes: null,
    needs_review: true,
  },
];

function noop() {
  /* no-op */
}

/**
 * Regression coverage for a real layout bug: `column.getSize()` always returns a number
 * (`@tanstack/react-table`'s own default, 150, when a column def sets none), so checking it —
 * as this table used to — can never distinguish "explicitly sized" from "should flex", and
 * every column ends up fixed-width: Description got clipped to a arbitrary 150px while unused
 * space sat blank past Notes. Only Description (the one column with no `size` in `columns.tsx`)
 * should get the flexible `1 1 0%`; every other column keeps the fixed width it asks for.
 */
describe("TransactionsTable column layout", () => {
  it("gives Description the flexible width and every other column a fixed one", () => {
    render(
      <TransactionsTable
        rows={TRANSACTIONS}
        context={{
          categories: CATEGORIES,
          selectedIds: new Set(),
          onToggleRow: noop,
          onEdit: noop,
        }}
      />,
    );

    const dateHeader = screen.getByText("Date");
    const descriptionHeader = screen.getByText("Description");
    const notesHeader = screen.getByText("Notes");

    expect(dateHeader.style.flex).toBe("0 0 104px");
    expect(notesHeader.style.flex).toBe("0 0 140px");
    expect(descriptionHeader.style.flex).toBe("1 1 0%");
  });

  it("keeps the date cell on one line and truncates a long description with a tooltip", () => {
    render(
      <TransactionsTable
        rows={TRANSACTIONS}
        context={{
          categories: CATEGORIES,
          selectedIds: new Set(),
          onToggleRow: noop,
          onEdit: noop,
        }}
      />,
    );

    const dateCell = screen.getByText("2026-02-05");
    expect(dateCell.className).toContain("whitespace-nowrap");

    const descriptionCell = screen.getByTitle("GARDEN CENTER");
    expect(descriptionCell.className).toContain("truncate");
  });
});
