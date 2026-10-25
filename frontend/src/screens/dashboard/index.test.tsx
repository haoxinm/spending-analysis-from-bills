import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/api/client";
import { ToastContextProvider } from "@/components/ui/toast-provider";

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

beforeEach(() => {
  window.localStorage.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={["/"]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <ToastContextProvider>{children}</ToastContextProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

type Route =
  | "/users"
  | "/accounts"
  | "/analytics/summary"
  | "/analytics/timeseries"
  | "/analytics/top-merchants"
  | "/net-worth/summary"
  | "/net-worth/entries";

const EMPTY_NET_WORTH = {
  currency: "USD",
  user_id: null,
  periods: [],
  series: [],
  account_series: [],
  snapshot: null,
};

function mockGet(responses: Partial<Record<Route, unknown>>) {
  (apiClient.GET as ReturnType<typeof vi.fn>).mockImplementation((path: string) => {
    const fallback = path === "/net-worth/summary" ? EMPTY_NET_WORTH : [];
    const data = responses[path as Route] ?? fallback;
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

  it("user chips filter every analytics query and hide the by-user comparison", async () => {
    mockGet({
      "/users": [
        { id: 1, name: "Alex", is_default: true },
        { id: 2, name: "Sam", is_default: false },
      ],
      "/accounts": [],
      "/analytics/summary": [
        { period: "2025-01", user: 1, currency: "USD", total_minor: 1000, txn_count: 1, avg_minor: 1000 },
      ],
      "/analytics/timeseries": [
        { period: "2025-01", currency: "USD", total_minor: 1000, txn_count: 1, avg_minor: 1000 },
      ],
      "/analytics/top-merchants": [],
    });

    render(<DashboardScreen />, { wrapper });
    await waitFor(() => expect(screen.getByTestId("user-comparison")).toBeInTheDocument());
    expect(screen.getByRole("radio", { name: "All users" })).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByRole("radio", { name: "Sam" }));

    await waitFor(() => {
      const calls = (apiClient.GET as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([path]) => path === "/analytics/timeseries",
      );
      const last = calls.at(-1)![1] as { params: { query: { user_ids?: number[] } } };
      expect(last.params.query.user_ids).toEqual([2]);
    });
    expect(screen.getByRole("radio", { name: "Sam" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByTestId("user-comparison")).not.toBeInTheDocument();
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

  it("renders the net-worth section even with no spending data, and follows the user chip", async () => {
    mockGet({
      "/users": [
        { id: 1, name: "Alex", is_default: true },
        { id: 2, name: "Sam", is_default: false },
      ],
      "/accounts": [],
      "/analytics/summary": [],
      "/analytics/timeseries": [],
      "/analytics/top-merchants": [],
    });

    render(<DashboardScreen />, { wrapper });

    expect(await screen.findByText("No data yet")).toBeInTheDocument();
    expect(await screen.findByTestId("net-worth-section")).toBeInTheDocument();
    expect(await screen.findByText("No balances yet")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("radio", { name: "Sam" }));

    await waitFor(() => {
      const calls = (apiClient.GET as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([path]) => path === "/net-worth/summary",
      );
      const last = calls.at(-1)![1] as { params: { query: { user_id?: number } } };
      expect(last.params.query.user_id).toBe(2);
    });
  });
});
