import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient, throwIfError } from "@/api/client";
import type { SpendQueryParams } from "@/hooks/use-spend-query-params";

import type { Kind } from "./types";

/** Rows fetched per page. Kept well under the 10k-row budget (§6.6) per request so the first
 *  page paints fast; `useTransactionsGrid` appends further pages as the user scrolls or asks
 *  for more, and the local windowing hook (`use-virtual-rows.ts`) keeps the DOM small no
 *  matter how many pages have been appended. */
export const GRID_PAGE_SIZE = 200;

/** The subset of `SpendQueryParams` (§3.9) that `GET /transactions` (§3.12) accepts, mapped
 *  onto that endpoint's own (snake_case) query parameter names. `granularity`, `groupBy` and
 *  `netRefunds` are analytics-only (§3.9) and have no meaning here, so they are dropped. */
export function toTransactionsQuery(filters: SpendQueryParams) {
  return {
    user_ids: filters.userIds,
    account_ids: filters.accountIds,
    date_from: filters.dateFrom,
    date_to: filters.dateTo,
    category_keys: filters.categoryKeys,
    subcategory_keys: filters.subcategoryKeys,
    amount_min_minor: filters.amountMinMinor,
    amount_max_minor: filters.amountMaxMinor,
    kinds: filters.kinds as Kind[] | undefined,
    include_non_spend: filters.includeNonSpend,
    search: filters.search,
    currency: filters.currency,
  };
}

export function transactionsQueryKey(filters: SpendQueryParams) {
  return ["transactions", "grid", toTransactionsQuery(filters)] as const;
}

/**
 * Paginated fetch of the filtered transaction list, one page per `GET /transactions` call
 * (§3.12). Pages accumulate client-side so the grid can virtualize over everything loaded so
 * far; `fetchNextPage` (wired to a "Load more" affordance and to scrolling near the bottom)
 * appends the next `GRID_PAGE_SIZE` rows without re-fetching what is already shown.
 */
export function useTransactionsGrid(filters: SpendQueryParams) {
  const query = toTransactionsQuery(filters);
  return useInfiniteQuery({
    queryKey: transactionsQueryKey(filters),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await apiClient.GET("/transactions", {
        params: { query: { ...query, page: pageParam, page_size: GRID_PAGE_SIZE } },
      });
      throwIfError(error);
      return data!;
    },
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((sum, page) => sum + page.items.length, 0);
      return loaded < lastPage.total ? pages.length + 1 : undefined;
    },
  });
}

export interface BulkUpdateInput {
  transactionIds: number[];
  categoryKey?: string | null;
  subcategoryKey?: string | null;
  kind?: Kind | null;
}

/** `POST /transactions/bulk-update` (§3.12): applies one label to an explicit list of ids
 *  (the caller resolves "the filtered selection" into ids before calling this — see
 *  `useAllMatchingIds` for "select everything the current filter matches"). */
export function useBulkUpdateTransactions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: BulkUpdateInput) => {
      const { data, error } = await apiClient.POST("/transactions/bulk-update", {
        body: {
          transaction_ids: input.transactionIds,
          category_key: input.categoryKey ?? undefined,
          subcategory_key: input.subcategoryKey ?? undefined,
          kind: input.kind ?? undefined,
        },
      });
      throwIfError(error);
      return data!;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["transactions"] });
    },
  });
}

/**
 * Resolves "every transaction the current filter matches" into an id list, for "select all N"
 * beyond what the grid has paged in so far. A single extra request (the API has no
 * ids-only projection, so this fetches full rows and keeps only `id`), capped so a runaway
 * filter can't ask for an unbounded response.
 */
export function useAllMatchingIds() {
  return useMutation({
    mutationFn: async ({
      filters,
      total,
    }: {
      filters: SpendQueryParams;
      total: number;
    }) => {
      const query = toTransactionsQuery(filters);
      const pageSize = Math.min(total, 20_000);
      const { data, error } = await apiClient.GET("/transactions", {
        params: { query: { ...query, page: 1, page_size: pageSize } },
      });
      throwIfError(error);
      return data!.items.map((item) => item.id);
    },
  });
}

/**
 * Downloads the full transaction export (`GET /export`, §3.12 — the endpoint exports
 * everything; it takes no filter params) as a file, entirely client-side (no server-rendered
 * download link to keep the per-launch token attached, A31).
 */
export async function downloadTransactionsExport(format: "csv" | "json" = "csv"): Promise<void> {
  const { data, error } = await apiClient.GET("/export", {
    params: { query: { format } },
    parseAs: "text",
  });
  throwIfError(error);
  const text = data ?? "";
  const mime = format === "csv" ? "text/csv" : "application/json";
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = `transactions.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } finally {
    URL.revokeObjectURL(url);
  }
}
