import { QueryClient } from "@tanstack/react-query";

/**
 * TanStack Query defaults per P1-F: this is a single-user local app, so aggressive
 * refetching (on focus, on every mount) is noise, not freshness.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});
