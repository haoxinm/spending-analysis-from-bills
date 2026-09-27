import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "@/api/client";

import { RulesTab } from "./rules-tab";
import { type ApiHandler, setMockHandlers, TestProviders } from "./test-utils";

vi.mock("@/api/client", async () => {
  const { dynamicMockFetch } = await import("./test-utils");
  vi.stubGlobal("fetch", dynamicMockFetch);
  return vi.importActual("@/api/client");
});

type Rule = components["schemas"]["Rule"];
type Category = components["schemas"]["Category"];

const TAXONOMY: Category[] = [
  {
    key: "food",
    name: "Food",
    subcategories: [
      { key: "coffee_shops", name: "Coffee shops", pending: false },
      { key: "groceries", name: "Groceries", pending: false },
    ],
  },
];

const RULES: Rule[] = [
  {
    id: 1,
    pattern: "starbucks",
    category_key: "food",
    subcategory_key: "coffee_shops",
    kind: null,
    source: "user",
  },
  {
    id: 2,
    pattern: "trader joe",
    category_key: "food",
    subcategory_key: "groceries",
    kind: null,
    source: "builtin",
  },
];

function setUpHandlers(overrides: Partial<Record<string, ApiHandler>> = {}) {
  setMockHandlers({
    "GET /rules": () => RULES,
    "GET /taxonomy": () => TAXONOMY,
    "GET /transactions": () => ({ items: [], total: 0 }),
    ...overrides,
  });
}

describe("RulesTab", () => {
  beforeEach(() => {
    setUpHandlers();
  });

  it("lists existing rules with their source badge", async () => {
    render(<RulesTab />, { wrapper: TestProviders });

    expect(await screen.findByText("starbucks")).toBeInTheDocument();
    expect(screen.getByText("trader joe")).toBeInTheDocument();
    expect(screen.getByText("Rules (2)")).toBeInTheDocument();
  });

  it("does not offer edit/delete for a builtin rule", async () => {
    render(<RulesTab />, { wrapper: TestProviders });
    await screen.findByText("trader joe");

    expect(
      screen.getByText("Built-in rules are managed in the corpus, not here."),
    ).toBeInTheDocument();
  });

  it("shows a live match count for a valid contains pattern", async () => {
    setUpHandlers({
      "GET /transactions": () => ({
        items: [
          {
            id: 1,
            statement_id: 1,
            account_id: 1,
            posted_date: "2026-01-01",
            transaction_date: null,
            description_clean: "x",
            amount_minor: 100,
            currency: "USD",
            kind: "purchase",
            category_key: null,
            subcategory_key: null,
            merchant_key: "starbucks 4102",
            notes: null,
            needs_review: false,
          },
          {
            id: 2,
            statement_id: 1,
            account_id: 1,
            posted_date: "2026-01-02",
            transaction_date: null,
            description_clean: "y",
            amount_minor: 200,
            currency: "USD",
            kind: "purchase",
            category_key: null,
            subcategory_key: null,
            merchant_key: "trader joes",
            notes: null,
            needs_review: false,
          },
        ],
        total: 2,
      }),
    });
    const user = userEvent.setup();
    render(<RulesTab />, { wrapper: TestProviders });
    await screen.findByText("starbucks");

    await user.type(screen.getByLabelText("Pattern"), "starbucks");

    await waitFor(
      () => {
        expect(screen.getByTestId("match-preview").textContent).toContain("Matches 1 of 2");
      },
      { timeout: 2000 },
    );
  });

  it("shows a validation error for a broken regex instead of a match count", async () => {
    const user = userEvent.setup();
    render(<RulesTab />, { wrapper: TestProviders });
    await screen.findByText("starbucks");

    await user.selectOptions(screen.getByLabelText("Match type"), "regex");
    await user.type(screen.getByLabelText("Pattern"), "(unterminated");

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/./);
    });
  });

  it("disables submit until a category/subcategory is chosen", async () => {
    const user = userEvent.setup();
    render(<RulesTab />, { wrapper: TestProviders });
    await screen.findByText("starbucks");

    await user.type(screen.getByLabelText("Pattern"), "costco");
    expect(screen.getByRole("button", { name: "Add rule" })).toBeDisabled();

    await user.selectOptions(screen.getByLabelText("Category / subcategory"), "food::groceries");
    expect(screen.getByRole("button", { name: "Add rule" })).toBeEnabled();
  });
});
