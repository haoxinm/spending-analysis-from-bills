import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Category } from "./types";

const CATEGORIES: Category[] = [
  {
    key: "groceries",
    name: "Groceries",
    subcategories: [{ key: "supermarket", name: "Supermarket", pending: false }],
  },
];

const TRANSACTIONS = [
  {
    id: 1,
    statement_id: 1,
    account_id: 1,
    posted_date: "2026-01-05",
    transaction_date: null,
    description_clean: "Corner Store",
    amount_minor: 1250,
    currency: "USD",
    kind: "purchase",
    category_key: null,
    subcategory_key: null,
    merchant_key: "corner-store",
    notes: null,
    needs_review: true,
  },
  {
    id: 2,
    statement_id: 1,
    account_id: 1,
    posted_date: "2026-01-06",
    transaction_date: null,
    description_clean: "Big Mart",
    amount_minor: 3400,
    currency: "USD",
    kind: "purchase",
    category_key: "groceries",
    subcategory_key: "supermarket",
    merchant_key: "big-mart",
    notes: null,
    needs_review: false,
  },
];

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** `openapi-fetch` always calls `fetch(new Request(url, init))` — a single `Request` argument,
 *  not `fetch(url, init)` — so every mock below reads the method/url off that `Request` (see
 *  `src/api/client.test.ts` for the same pattern). */
function callsTo(fetchMock: FetchMock, method: string, urlIncludes: string): Request[] {
  return fetchMock.mock.calls
    .map(([request]) => request)
    .filter((request) => request.method === method && request.url.includes(urlIncludes));
}

type FetchMock = ReturnType<typeof vi.fn<(request: Request) => Response | Promise<Response>>>;

describe("TransactionsScreen", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Every test needs the *typed API client's* `globalThis.fetch` reference captured after this
  // test's own mock is installed (`openapi-fetch` binds `fetch` once, at `createClient()` time
  // — see `src/api/client.ts`). `vi.resetModules()` plus a dynamic import of the whole chain
  // (provider included, so the `ToastContext` object `useToast` reads is the same instance the
  // dynamically-imported screen was built against) gives each test a fresh, correctly-bound
  // module graph.
  async function mountWithFetch(fetchImpl: (request: Request) => Promise<Response> | Response) {
    const fetchMock: FetchMock = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetchMock);
    const [{ default: TransactionsScreen }, { ToastContextProvider }, { Toaster }] = await Promise.all([
      import("./index"),
      import("@/components/ui/toast-provider"),
      import("@/components/ui/toaster"),
    ]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter
          initialEntries={["/transactions"]}
          future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
          <ToastContextProvider>
            <TransactionsScreen />
            <Toaster />
          </ToastContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    return fetchMock;
  }

  it("lists transactions once the grid and taxonomy load", async () => {
    await mountWithFetch((request) => {
      if (request.url.includes("/api/taxonomy")) return jsonResponse(CATEGORIES);
      if (request.url.includes("/api/transactions")) {
        return jsonResponse({ items: TRANSACTIONS, total: 2 });
      }
      throw new Error(`unexpected fetch: ${request.method} ${request.url}`);
    });

    expect(await screen.findByText("Corner Store")).toBeInTheDocument();
    expect(screen.getByText("Big Mart")).toBeInTheDocument();
    expect(screen.getByText("2 transactions")).toBeInTheDocument();
  });

  it("shows an empty state when no transaction matches", async () => {
    await mountWithFetch((request) => {
      if (request.url.includes("/api/taxonomy")) return jsonResponse(CATEGORIES);
      if (request.url.includes("/api/transactions")) return jsonResponse({ items: [], total: 0 });
      throw new Error(`unexpected fetch: ${request.method} ${request.url}`);
    });

    expect(await screen.findByText("No transactions match these filters")).toBeInTheDocument();
  });

  it("edits a transaction's category through the inline popover", async () => {
    const user = userEvent.setup();
    const fetchMock = await mountWithFetch((request) => {
      if (request.url.includes("/api/taxonomy")) return jsonResponse(CATEGORIES);
      if (request.method === "GET" && request.url.includes("/api/transactions")) {
        return jsonResponse({ items: TRANSACTIONS, total: 2 });
      }
      if (request.method === "PATCH" && request.url.includes("/api/transactions/1")) {
        return jsonResponse({
          ...TRANSACTIONS[0],
          category_key: "groceries",
          subcategory_key: "supermarket",
        });
      }
      throw new Error(`unexpected fetch: ${request.method} ${request.url}`);
    });

    await screen.findByText("Corner Store");
    await user.click(screen.getByRole("button", { name: "Uncategorized" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit transaction 1" });
    await user.selectOptions(within(dialog).getByLabelText("Category"), "groceries");
    await user.selectOptions(within(dialog).getByLabelText("Subcategory"), "supermarket");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const patchCalls = callsTo(fetchMock, "PATCH", "/api/transactions/1");
    expect(patchCalls).toHaveLength(1);
    const body = (await patchCalls[0]!.clone().json()) as Record<string, unknown>;
    expect(body).toMatchObject({ category_key: "groceries", subcategory_key: "supermarket" });
  });

  it("bulk-applies a label to selected rows", async () => {
    const user = userEvent.setup();
    const fetchMock = await mountWithFetch((request) => {
      if (request.url.includes("/api/taxonomy")) return jsonResponse(CATEGORIES);
      if (request.method === "GET" && request.url.includes("/api/transactions")) {
        return jsonResponse({ items: TRANSACTIONS, total: 2 });
      }
      if (request.method === "POST" && request.url.includes("/api/transactions/bulk-update")) {
        return jsonResponse({ updated: 1 });
      }
      throw new Error(`unexpected fetch: ${request.method} ${request.url}`);
    });

    await screen.findByText("Corner Store");
    await user.click(screen.getByRole("checkbox", { name: "Select transaction 1" }));

    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Bulk category"), "groceries");
    await user.selectOptions(screen.getByLabelText("Bulk subcategory"), "supermarket");
    await user.click(screen.getByRole("button", { name: "Apply to 1" }));

    await waitFor(() => expect(screen.getByText("Updated 1 transaction")).toBeInTheDocument());

    const bulkCalls = callsTo(fetchMock, "POST", "/api/transactions/bulk-update");
    expect(bulkCalls).toHaveLength(1);
    const body = (await bulkCalls[0]!.clone().json()) as Record<string, unknown>;
    expect(body).toMatchObject({ transaction_ids: [1], category_key: "groceries" });
  });
});
