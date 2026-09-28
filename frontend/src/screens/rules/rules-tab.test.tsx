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
      { id: 1, key: "coffee_shops", name: "Coffee shops", pending: false },
      { id: 2, key: "groceries", name: "Groceries", pending: false },
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

  it("filters the rule list by a search term matching the pattern or the category", async () => {
    const user = userEvent.setup();
    render(<RulesTab />, { wrapper: TestProviders });
    await screen.findByText("starbucks");
    expect(screen.getByText("trader joe")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search rules"), "starbucks");

    expect(screen.getByText("starbucks")).toBeInTheDocument();
    expect(screen.queryByText("trader joe")).not.toBeInTheDocument();
    expect(screen.getByText("Rules (1 of 2)")).toBeInTheDocument();
  });

  it("shows a no-match message and no rows for a search with no hits", async () => {
    const user = userEvent.setup();
    render(<RulesTab />, { wrapper: TestProviders });
    await screen.findByText("starbucks");

    await user.type(screen.getByLabelText("Search rules"), "zzz-nomatch");

    expect(screen.getByText(/No rules match/)).toBeInTheDocument();
    expect(screen.queryByText("starbucks")).not.toBeInTheDocument();
  });
});

/** With ~120 built-in rules (§ the corpus) plus any the user adds, this list needs its own
 * paging so it never dumps every row onto one enormous page (a real usability bug — the whole
 * screen used to render as one ~8600px-tall page). */
describe("RulesTab pagination", () => {
  function manyRules(count: number): Rule[] {
    return Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      pattern: `merchant-${String(i + 1).padStart(3, "0")}`,
      category_key: "food",
      subcategory_key: "groceries",
      kind: null,
      source: "builtin" as const,
    }));
  }

  beforeEach(() => {
    setUpHandlers({ "GET /rules": () => manyRules(60) });
  });

  it("shows only the first page's worth of rules, with page controls", async () => {
    render(<RulesTab />, { wrapper: TestProviders });

    await screen.findByText("merchant-001");
    expect(screen.getByText("merchant-025")).toBeInTheDocument();
    expect(screen.queryByText("merchant-026")).not.toBeInTheDocument();
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });

  it("advances to the next page", async () => {
    const user = userEvent.setup();
    render(<RulesTab />, { wrapper: TestProviders });

    await screen.findByText("merchant-001");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("merchant-026")).toBeInTheDocument();
    expect(screen.queryByText("merchant-001")).not.toBeInTheDocument();
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
  });

  it("resets to page 1 when the search term changes", async () => {
    const user = userEvent.setup();
    render(<RulesTab />, { wrapper: TestProviders });

    await screen.findByText("merchant-001");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Search rules"), "merchant-05");

    expect(screen.getByText("merchant-050")).toBeInTheDocument();
    expect(screen.queryByText("Page 2")).not.toBeInTheDocument();
  });
});
