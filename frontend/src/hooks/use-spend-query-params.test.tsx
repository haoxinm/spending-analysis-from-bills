import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { useSpendQueryParams } from "./use-spend-query-params";

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MemoryRouter
      initialEntries={["/?date_from=2025-01-01"]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      {children}
    </MemoryRouter>
  );
}

describe("useSpendQueryParams", () => {
  it("parses an initial URL search param", () => {
    const { result } = renderHook(() => useSpendQueryParams(), { wrapper });
    expect(result.current[0].dateFrom).toBe("2025-01-01");
  });

  it("round-trips a list param", () => {
    const { result } = renderHook(() => useSpendQueryParams(), { wrapper });

    act(() => {
      result.current[1]({ categoryKeys: ["groceries", "dining"] });
    });

    expect(result.current[0].categoryKeys).toEqual(["groceries", "dining"]);
  });

  it("removes a field from the URL when set to undefined", () => {
    const { result } = renderHook(() => useSpendQueryParams(), { wrapper });

    act(() => {
      result.current[1]({ dateFrom: undefined });
    });

    expect(result.current[0].dateFrom).toBeUndefined();
  });

  it("round-trips numeric list params as numbers", () => {
    const { result } = renderHook(() => useSpendQueryParams(), { wrapper });

    act(() => {
      result.current[1]({ userIds: [1, 2, 3] });
    });

    expect(result.current[0].userIds).toEqual([1, 2, 3]);
  });

  it("round-trips a boolean param", () => {
    const { result } = renderHook(() => useSpendQueryParams(), { wrapper });

    act(() => {
      result.current[1]({ netRefunds: false });
    });

    expect(result.current[0].netRefunds).toBe(false);
  });
});
