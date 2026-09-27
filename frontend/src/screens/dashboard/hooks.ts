import { useQuery } from "@tanstack/react-query";

import { apiClient, throwIfError } from "@/api/client";

/** The subset of `SpendQuery` (§3.9) every dashboard chart shares: who, when, and which
 * currency to filter to (D5: never converted). Each hook below adds its own `group_by` /
 * `granularity` / `limit` on top, since those differ per chart and per `/api/analytics/*`
 * route (§3.12). */
export interface DashboardFilters {
  userIds?: number[];
  dateFrom?: string;
  dateTo?: string;
  currency?: string;
}

type Granularity = "day" | "week" | "month" | "quarter" | "year" | "all";

/** All accounts, used only to detect other currencies in scope (D5's banner) — the dashboard
 * does not offer per-account filtering in v1. */
export function useAccounts() {
  return useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/accounts");
      throwIfError(error);
      return data ?? [];
    },
  });
}

/** `GET /api/analytics/summary` grouped by `["period", "category"]` — feeds the stacked bar. */
export function useCategoryBreakdown(filters: DashboardFilters, granularity: Granularity) {
  return useQuery({
    queryKey: ["dashboard", "category-breakdown", filters, granularity],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/analytics/summary", {
        params: {
          query: {
            user_ids: filters.userIds,
            date_from: filters.dateFrom,
            date_to: filters.dateTo,
            currency: filters.currency,
            granularity,
            group_by: ["period", "category"],
          },
        },
      });
      throwIfError(error);
      return data ?? [];
    },
  });
}

/** `GET /api/analytics/summary` grouped by `["user"]` — feeds the user-comparison panel, only
 * fetched (`enabled`) when more than one user exists (P3-D's brief). */
export function useUserBreakdown(filters: DashboardFilters, enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard", "user-breakdown", filters],
    enabled,
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/analytics/summary", {
        params: {
          query: {
            user_ids: filters.userIds,
            date_from: filters.dateFrom,
            date_to: filters.dateTo,
            currency: filters.currency,
            granularity: "all",
            group_by: ["user"],
          },
        },
      });
      throwIfError(error);
      return data ?? [];
    },
  });
}

/** `GET /api/analytics/timeseries` grouped by `["period"]` — feeds the trend line and the
 * month-over-month delta. */
export function useTrend(filters: DashboardFilters, granularity: Granularity) {
  return useQuery({
    queryKey: ["dashboard", "trend", filters, granularity],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/analytics/timeseries", {
        params: {
          query: {
            user_ids: filters.userIds,
            date_from: filters.dateFrom,
            date_to: filters.dateTo,
            currency: filters.currency,
            granularity,
            group_by: ["period"],
          },
        },
      });
      throwIfError(error);
      return data ?? [];
    },
  });
}

/** `GET /api/analytics/top-merchants`, ranked server-side (§3.12). */
export function useTopMerchants(filters: DashboardFilters, limit = 8) {
  return useQuery({
    queryKey: ["dashboard", "top-merchants", filters, limit],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/analytics/top-merchants", {
        params: {
          query: {
            user_ids: filters.userIds,
            date_from: filters.dateFrom,
            date_to: filters.dateTo,
            currency: filters.currency,
            limit,
          },
        },
      });
      throwIfError(error);
      return data ?? [];
    },
  });
}
