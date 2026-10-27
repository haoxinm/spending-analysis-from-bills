import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { apiClient } from "@/api/client";

import { useUpdateSettings, useUpdateUser } from "./hooks";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { GET: vi.fn(), PUT: vi.fn(), PATCH: vi.fn() } };
});

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { spy, wrapper };
}

describe("LLM preview invalidation", () => {
  it("saving settings invalidates every cached LLM preview", async () => {
    (apiClient.PUT as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {}, error: undefined });
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useUpdateSettings(), { wrapper });
    result.current.mutate({} as never);
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["llm-preview"] }));
  });

  it("editing a user (personal-info aliases) invalidates every cached LLM preview", async () => {
    (apiClient.PATCH as ReturnType<typeof vi.fn>).mockResolvedValue({ data: {}, error: undefined });
    const { spy, wrapper } = setup();
    const { result } = renderHook(() => useUpdateUser(), { wrapper });
    result.current.mutate({ id: 1, body: { name: "x" } });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ["llm-preview"] }));
  });
});
