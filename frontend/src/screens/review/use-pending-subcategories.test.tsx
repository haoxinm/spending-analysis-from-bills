import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiFetchMock, makeCategory, jsonResponse } from "./test-support";
import type { Category } from "./types";

/**
 * Same module-freshness concern as `use-review-queue.test.ts`: `apiClient` and `useTaxonomy`
 * (via `@/api/hooks` → `@/api/client`) are module singletons built from whatever `fetch` is
 * global at import time, so every test stubs `fetch` and resets modules before importing.
 */
async function setup(state: {
  categories: Category[];
  approveBehavior?: (id: number) => Response;
  mergeBehavior?: (id: number, intoId: number) => Response;
}) {
  vi.resetModules();
  const fetchMock = vi.fn(
    createApiFetchMock({
      categories: state.categories,
      approveBehavior: state.approveBehavior,
      mergeBehavior: state.mergeBehavior,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { usePendingSubcategories } = await import("./use-pending-subcategories");
  const { ToastContextProvider } = await import("@/components/ui/toast-provider");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastContextProvider>{children}</ToastContextProvider>
      </QueryClientProvider>
    );
  }
  return { fetchMock, usePendingSubcategories, wrapper, queryClient };
}

describe("usePendingSubcategories", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists only pending, not-yet-merged subcategories", async () => {
    const categories = [
      makeCategory({
        key: "dining",
        name: "Dining",
        subcategories: [
          { key: "yami", name: "Yami", pending: true, merged_into: null },
          { key: "restaurants", name: "Restaurants", pending: false, merged_into: null },
          { key: "old-store", name: "Old store", pending: true, merged_into: "5" },
        ],
      }),
    ];
    const { usePendingSubcategories, wrapper } = await setup({ categories });

    const { result } = renderHook(() => usePendingSubcategories(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.pending.map((row) => row.key)).toEqual(["yami"]);
  });

  it("disables approve/merge for a row with no numeric id (today's backend contract)", async () => {
    const categories = [
      makeCategory({
        key: "dining",
        subcategories: [{ key: "yami", name: "Yami", pending: true, merged_into: null }],
      }),
    ];
    const { usePendingSubcategories, wrapper } = await setup({ categories });

    const { result } = renderHook(() => usePendingSubcategories(), { wrapper });
    await waitFor(() => expect(result.current.pending).toHaveLength(1));

    expect(result.current.pending[0]?.id).toBeUndefined();
  });

  it("approve, when a numeric id is present, optimistically removes the row and calls the API", async () => {
    const categories = [
      makeCategory({
        key: "dining",
        subcategories: [
          { key: "yami", name: "Yami", pending: true, merged_into: null, id: 42 } as never,
        ],
      }),
    ];
    const { usePendingSubcategories, wrapper, fetchMock } = await setup({ categories });

    const { result } = renderHook(() => usePendingSubcategories(), { wrapper });
    await waitFor(() => expect(result.current.pending).toHaveLength(1));

    const row = result.current.pending[0];
    if (!row) throw new Error("expected a pending row");

    act(() => result.current.approve(row));

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          (call) => (call[0] as Request).method === "POST" && (call[0] as Request).url.includes("/approve"),
        ),
      ).toBe(true),
    );
    await waitFor(() => expect(result.current.pending).toHaveLength(0));
  });

  it("rolls back approve when the API call fails", async () => {
    const categories = [
      makeCategory({
        key: "dining",
        subcategories: [
          { key: "yami", name: "Yami", pending: true, merged_into: null, id: 42 } as never,
        ],
      }),
    ];
    const { usePendingSubcategories, wrapper } = await setup({
      categories,
      approveBehavior: () => jsonResponse({ detail: "boom" }, 500),
    });

    const { result } = renderHook(() => usePendingSubcategories(), { wrapper });
    await waitFor(() => expect(result.current.pending).toHaveLength(1));

    const row = result.current.pending[0];
    if (!row) throw new Error("expected a pending row");

    act(() => result.current.approve(row));

    // Optimistic removal happens immediately, then the failed request restores it.
    await waitFor(() => expect(result.current.pending.map((r) => r.key)).toEqual(["yami"]));
  });

  it("merge targets only list active subcategories that have a numeric id", async () => {
    const categories = [
      makeCategory({
        key: "dining",
        subcategories: [
          { key: "yami", name: "Yami", pending: true, merged_into: null },
          { key: "restaurants", name: "Restaurants", pending: false, merged_into: null, id: 7 } as never,
          { key: "no-id-active", name: "No id", pending: false, merged_into: null },
        ],
      }),
    ];
    const { usePendingSubcategories, wrapper } = await setup({ categories });

    const { result } = renderHook(() => usePendingSubcategories(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.mergeTargets.map((t) => t.key)).toEqual(["restaurants"]);
  });
});
