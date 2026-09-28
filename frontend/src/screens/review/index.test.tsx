import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiFetchMock, makeCategory, makeTransaction } from "./test-support";
import type { Category, Transaction } from "./types";

/**
 * Same module-freshness concern as the hook tests: `apiClient` is a module singleton built from
 * whatever `fetch` is global at import time, so the screen itself is imported fresh, after the
 * fetch stub is in place.
 */
async function renderScreen(state: { transactions: Transaction[]; categories: Category[] }) {
  vi.resetModules();
  const fetchMock = vi.fn(createApiFetchMock(state));
  vi.stubGlobal("fetch", fetchMock);

  const { default: ReviewScreen } = await import("./index");
  const { ToastContextProvider } = await import("@/components/ui/toast-provider");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <QueryClientProvider client={queryClient}>
      <ToastContextProvider>
        <ReviewScreen />
      </ToastContextProvider>
    </QueryClientProvider>,
  );

  return { fetchMock };
}

const CATEGORIES: Category[] = [
  makeCategory({
    key: "dining",
    name: "Dining",
    subcategories: [
      { id: 1, key: "dining", name: "Dining (general)", pending: false, merged_into: null },
      { id: 2, key: "restaurants", name: "Restaurants", pending: false, merged_into: null },
    ],
  }),
  makeCategory({
    key: "groceries",
    name: "Groceries",
    subcategories: [{ id: 3, key: "groceries", name: "Groceries", pending: false, merged_into: null }],
  }),
];

function lastPatchBody(fetchMock: ReturnType<typeof vi.fn>): Promise<Record<string, unknown>> {
  const call = [...fetchMock.mock.calls].reverse().find((c) => (c[0] as Request).method === "PATCH");
  const request = call?.[0] as Request | undefined;
  if (!request) throw new Error("no PATCH request was made");
  return request.clone().json() as Promise<Record<string, unknown>>;
}

describe("ReviewScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the queue and the current transaction", async () => {
    await renderScreen({
      transactions: [
        makeTransaction({ id: 1, description_clean: "Coffee Shop", category_key: null, subcategory_key: null }),
        makeTransaction({ id: 2, description_clean: "Grocery Store" }),
      ],
      categories: CATEGORIES,
    });

    await waitFor(() => expect(screen.getByText("2 need review")).toBeInTheDocument());
    expect(screen.getByText("Coffee Shop")).toBeInTheDocument();
  });

  it("j/k move between transactions", async () => {
    await renderScreen({
      transactions: [
        makeTransaction({ id: 1, description_clean: "Coffee Shop" }),
        makeTransaction({ id: 2, description_clean: "Grocery Store" }),
      ],
      categories: CATEGORIES,
    });
    await waitFor(() => expect(screen.getByText("Coffee Shop")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "j" });
    await waitFor(() => expect(screen.getByText("Grocery Store")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "k" });
    await waitFor(() => expect(screen.getByText("Coffee Shop")).toBeInTheDocument());
  });

  it("a digit stages a category, and Enter accepts it (PATCH + queue shrinks)", async () => {
    const { fetchMock } = await renderScreen({
      transactions: [
        makeTransaction({ id: 1, description_clean: "Coffee Shop", category_key: null, subcategory_key: null }),
        makeTransaction({ id: 2, description_clean: "Grocery Store" }),
      ],
      categories: CATEGORIES,
    });
    await waitFor(() => expect(screen.getByText("Coffee Shop")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "1" }); // stages "dining"
    await waitFor(() => expect(screen.getAllByText("Dining").length).toBeGreaterThan(0));

    fireEvent.keyDown(document, { key: "Enter" });

    await waitFor(async () => {
      const body = await lastPatchBody(fetchMock);
      expect(body).toMatchObject({ category_key: "dining", subcategory_key: "dining", create_rule: false });
    });
    await waitFor(() => expect(screen.getByText("1 need review")).toBeInTheDocument());
    expect(screen.getByText("Grocery Store")).toBeInTheDocument();
  });

  it("r accepts and creates a rule (create_rule: true)", async () => {
    const { fetchMock } = await renderScreen({
      transactions: [makeTransaction({ id: 1, category_key: "groceries", subcategory_key: "groceries" })],
      categories: CATEGORIES,
    });
    await waitFor(() => expect(screen.getByText("1 need review")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "r" });

    await waitFor(async () => {
      const body = await lastPatchBody(fetchMock);
      expect(body.create_rule).toBe(true);
    });
    await waitFor(() => expect(screen.getByText("Nothing needs review")).toBeInTheDocument());
  });

  it("u undoes the most recent accept, restoring the row", async () => {
    await renderScreen({
      transactions: [makeTransaction({ id: 1, category_key: "groceries", subcategory_key: "groceries" })],
      categories: CATEGORIES,
    });
    await waitFor(() => expect(screen.getByText("1 need review")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Nothing needs review")).toBeInTheDocument());

    fireEvent.keyDown(document, { key: "u" });
    await waitFor(() => expect(screen.getByText("1 need review")).toBeInTheDocument());
  });

  it("ignores keyboard shortcuts while a text input has focus", async () => {
    await renderScreen({
      transactions: [
        makeTransaction({ id: 1, description_clean: "Coffee Shop" }),
        makeTransaction({ id: 2, description_clean: "Grocery Store" }),
      ],
      categories: CATEGORIES,
    });
    await waitFor(() => expect(screen.getByText("Coffee Shop")).toBeInTheDocument());

    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    fireEvent.keyDown(input, { key: "j" });

    expect(screen.getByText("Coffee Shop")).toBeInTheDocument(); // did not move
    document.body.removeChild(input);
  });
});
