import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/api/client";

import DashboardScreen from "./index";

// Recharts' `ResponsiveContainer` observes its size; jsdom has no `ResizeObserver`.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

// Mocks the transport at the client module boundary rather than `fetch`, so the dashboard's
// hooks can be exercised without depending on `openapi-fetch`'s exact request-building
// internals (its real client already has a round-trip test in `api/client.test.ts`).
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { GET: vi.fn() } };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={["/"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        {children}
      </MemoryRouter>
    </QueryClientProvider>
  );
}

type Route = "/users" | "/accounts" | "/analytics/summary" | "/analytics/timeseries" | "/analytics/top-merchants";

function mockGet(responses: Partial<Record<Route, unknown>>) {
  (apiClient.GET as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    const data = responses[path as Route] ?? [];
    return Promise.resolve({ data, error: undefined });
  });
}

describe("DashboardScreen", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows an empty state before any data exists", async () => {
    mockGet({
      "/users": [{ id: 1, name: "Alex", is_default: true }],
      "/accounts": [],
      "/analytics/summary": [],
      "/analytics/timeseries": [],
      "/analytics/top-merchants": [],
    });

    render(<DashboardScreen />, { wrapper });

    expect(await screen.findByText("No data yet")).toBeInTheDocument();
  });

  it("renders the category chart, trend, and top merchants once data exists", async () => {
    mockGet({
      "/users": [{ id: 1, name: "Alex", is_default: true }],
      "/accounts": [{ id: 1, user_id: 1, issuer_id: null, account_type: "credit", currency: "USD" }],
      "/analytics/summary": [
        {
          period: "2025-01",
          category: "groceries",
          currency: "USD",
          total_minor: 5000,
          txn_count: 3,
          avg_minor: 1666,
        },
      ],
      "/analytics/timeseries": [
        { period: "2025-01", currency: "USD", total_minor: 5000, txn_count: 3, avg_minor: 1666 },
        { period: "2025-02", currency: "USD", total_minor: 6000, txn_count: 4, avg_minor: 1500 },
      ],
      "/analytics/top-merchants": [{ merchant: "Corner Store", total_minor: 2000, txn_count: 2 }],
    });

    render(<DashboardScreen />, { wrapper });

    await waitFor(() => expect(screen.getByTestId("category-stacked-bar")).toBeInTheDocument());
    expect(screen.getByTestId("trend-line")).toBeInTheDocument();
    expect(screen.getByTestId("top-merchants")).toBeInTheDocument();
    expect(screen.getByText("Corner Store")).toBeInTheDocument();
    // Month-over-month: two periods present, so a delta renders.
    expect(screen.getByTestId("month-over-month")).toBeInTheDocument();
    // Only one user: no per-user comparison card.
    expect(screen.queryByTestId("user-comparison")).not.toBeInTheDocument();
  });

  it("shows the user comparison panel only when more than one user exists", async () => {
    mockGet({
      "/users": [
        { id: 1, name: "Alex", is_default: true },
        { id: 2, name: "Sam", is_default: false },
      ],
      "/accounts": [],
      "/analytics/summary": [
        { period: "2025-01", user: 1, currency: "USD", total_minor: 1000, txn_count: 1, avg_minor: 1000 },
        { period: "2025-01", user: 2, currency: "USD", total_minor: 2000, txn_count: 1, avg_minor: 2000 },
      ],
      "/analytics/timeseries": [],
      "/analytics/top-merchants": [],
    });

    render(<DashboardScreen />, { wrapper });

    await waitFor(() => expect(screen.getByTestId("user-comparison")).toBeInTheDocument());
  });

  it("banners other currencies present outside the current filter (D5)", async () => {
    mockGet({
      "/users": [{ id: 1, name: "Alex", is_default: true }],
      "/accounts": [
        { id: 1, user_id: 1, issuer_id: null, account_type: "credit", currency: "USD" },
        { id: 2, user_id: 1, issuer_id: null, account_type: "checking", currency: "EUR" },
      ],
      "/analytics/summary": [],
      "/analytics/timeseries": [],
      "/analytics/top-merchants": [],
    });

    render(<DashboardScreen />, { wrapper });

    const banner = await screen.findByTestId("currency-banner");
    expect(within(banner).getByText("EUR")).toBeInTheDocument();
    expect(within(banner).getByText(/Not included/)).toBeInTheDocument();
  });
});
