import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiFetchMock, jsonResponse, makeTransaction } from "./test-support";
import type { Transaction } from "./types";

/**
 * `apiClient` (`api/client.ts`) is a module-level `openapi-fetch` client built once, at import
 * time, from whatever `fetch` is global then (see `api/client.test.ts`, which does the same for
 * the same reason). So every test here stubs `fetch` and resets the module registry *before*
 * importing `useReviewQueue` — and, for the same reason, imports `ToastContextProvider`
 * fresh too: a stale copy would hold a different `ToastContext` object than the one the reloaded
 * `useReviewQueue` (via `useToast`) reads, and `useContext` would come back empty.
 */
async function setup(options: {
  transactions: Transaction[];
  patchBehavior?: (id: number, body: unknown) => Response;
}) {
  vi.resetModules();
  const fetchMock = vi.fn(createApiFetchMock({ transactions: options.transactions, patchTransactionBehavior: options.patchBehavior }));
  vi.stubGlobal("fetch", fetchMock);
  const { useReviewQueue } = await import("./use-review-queue");
  const { ToastContextProvider } = await import("@/components/ui/toast-provider");
  return { fetchMock, useReviewQueue, wrapper: ToastContextProvider };
}

describe("useReviewQueue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads only the needs_review transactions, across pages", async () => {
    const { useReviewQueue, wrapper } = await setup({
      transactions: [
        makeTransaction({ id: 1, needs_review: true }),
        makeTransaction({ id: 2, needs_review: false }),
        makeTransaction({ id: 3, needs_review: true }),
      ],
    });

    const { result } = renderHook(() => useReviewQueue(), { wrapper });

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.queue.map((t) => t.id)).toEqual([1, 3]);
    expect(result.current.current?.id).toBe(1);
  });

  it("j/k move the cursor and clamp at the ends", async () => {
    const { useReviewQueue, wrapper } = await setup({
      transactions: [makeTransaction({ id: 1 }), makeTransaction({ id: 2 })],
    });

    const { result } = renderHook(() => useReviewQueue(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.previous());
    expect(result.current.current?.id).toBe(1); // clamped, no earlier row

    act(() => result.current.next());
    expect(result.current.current?.id).toBe(2);

    act(() => result.current.next());
    expect(result.current.current?.id).toBe(2); // clamped, no later row
  });

  it("accept sends the staged pick and optimistically removes the row", async () => {
    const { fetchMock, useReviewQueue, wrapper } = await setup({
      transactions: [makeTransaction({ id: 1, category_key: "others", subcategory_key: "uncategorized" })],
    });

    const { result } = renderHook(() => useReviewQueue(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.stage("dining", "restaurants"));
    expect(result.current.stagedForCurrent).toEqual({ categoryKey: "dining", subcategoryKey: "restaurants" });

    await act(async () => {
      await result.current.accept();
    });

    expect(result.current.queue).toHaveLength(0);
    expect(result.current.canUndo).toBe(true);

    const patchCall = fetchMock.mock.calls.find((call) => (call[0] as Request).method === "PATCH");
    expect(patchCall).toBeDefined();
    const patchRequest = patchCall?.[0] as Request;
    const body = JSON.parse(await patchRequest.clone().text()) as Record<string, unknown>;
    expect(body).toMatchObject({
      category_key: "dining",
      subcategory_key: "restaurants",
      create_rule: false,
    });
  });

  it("accept falls back to the cascade's own proposal when nothing is staged", async () => {
    const { useReviewQueue, wrapper } = await setup({
      transactions: [makeTransaction({ id: 1, category_key: "groceries", subcategory_key: "supermarket" })],
    });

    const { result } = renderHook(() => useReviewQueue(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.accept();
    });

    expect(result.current.queue).toHaveLength(0);
  });

  it("accept with createRule sends create_rule: true", async () => {
    const { fetchMock, useReviewQueue, wrapper } = await setup({
      transactions: [makeTransaction({ id: 1, category_key: "groceries", subcategory_key: "supermarket" })],
    });

    const { result } = renderHook(() => useReviewQueue(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.accept({ createRule: true });
    });

    const patchRequest = fetchMock.mock.calls.find((call) => (call[0] as Request).method === "PATCH")?.[0] as Request;
    const body = JSON.parse(await patchRequest.clone().text()) as Record<string, unknown>;
    expect(body.create_rule).toBe(true);
  });

  it("refuses to accept when there is no category to accept, without calling PATCH", async () => {
    const { fetchMock, useReviewQueue, wrapper } = await setup({
      transactions: [makeTransaction({ id: 1, category_key: null, subcategory_key: null })],
    });

    const { result } = renderHook(() => useReviewQueue(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    await act(async () => {
      await result.current.accept();
    });

    expect(result.current.queue).toHaveLength(1); // still there
    expect(fetchMock.mock.calls.some((call) => (call[0] as Request).method === "PATCH")).toBe(false);
  });

  it("rolls back an accept that fails: the row reappears at its original position", async () => {
    const { fetchMock, useReviewQueue, wrapper } = await setup({
      transactions: [
        makeTransaction({ id: 1 }),
        makeTransaction({ id: 2, category_key: "groceries", subcategory_key: "supermarket" }),
        makeTransaction({ id: 3 }),
      ],
      patchBehavior: (id) => {
        if (id === 2) return jsonResponse({ detail: "server exploded" }, 500);
        return jsonResponse(makeTransaction({ id, needs_review: false }));
      },
    });

    const { result } = renderHook(() => useReviewQueue(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.next()); // move to transaction 2
    expect(result.current.current?.id).toBe(2);

    await act(async () => {
      await result.current.accept();
    });

    // Rolled back: still 3 rows, transaction 2 back in the middle, cursor back on it.
    expect(result.current.queue.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(result.current.current?.id).toBe(2);
    expect(result.current.canUndo).toBe(false);
    expect(fetchMock.mock.calls.filter((call) => (call[0] as Request).method === "PATCH")).toHaveLength(1);
  });

  it("undo reverts the most recent accept and reinserts the row", async () => {
    const { fetchMock, useReviewQueue, wrapper } = await setup({
      transactions: [
        makeTransaction({ id: 1, category_key: "others", subcategory_key: "uncategorized", kind: "purchase" }),
        makeTransaction({ id: 2 }),
      ],
    });

    const { result } = renderHook(() => useReviewQueue(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("ready"));

    act(() => result.current.stage("dining", "restaurants"));
    await act(async () => {
      await result.current.accept();
    });
    expect(result.current.queue.map((t) => t.id)).toEqual([2]);

    await act(async () => {
      await result.current.undo();
    });

    expect(result.current.queue.map((t) => t.id)).toEqual([1, 2]);
    expect(result.current.canUndo).toBe(false);

    const patchCalls = fetchMock.mock.calls.filter((call) => (call[0] as Request).method === "PATCH");
    const undoBody = JSON.parse(await (patchCalls.at(-1)?.[0] as Request).clone().text()) as Record<
      string,
      unknown
    >;
    expect(undoBody).toMatchObject({
      category_key: "others",
      subcategory_key: "uncategorized",
      kind: "purchase",
    });
  });
});
