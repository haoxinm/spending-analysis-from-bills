import * as React from "react";

import { useUsers } from "@/api/hooks";
import type { DateRange } from "@/components/primitives/date-range-picker";
import { EmptyState, ErrorState, LoadingState } from "@/components/primitives/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSpendQueryParams } from "@/hooks/use-spend-query-params";

import { CategoryStackedBar } from "./components/category-stacked-bar";
import { CurrencyBanner } from "./components/currency-banner";
import { FiltersBar } from "./components/filters-bar";
import { MonthOverMonth } from "./components/month-over-month";
import { TopMerchants } from "./components/top-merchants";
import { TrendLine } from "./components/trend-line";
import { UserComparison } from "./components/user-comparison";
import {
  type DashboardFilters,
  useAccounts,
  useCategoryBreakdown,
  useTopMerchants,
  useTrend,
  useUserBreakdown,
} from "./hooks";
import { computeMonthOverMonthDelta, detectOtherCurrencies, toTrendPoints, totalsByUser } from "./logic";

/**
 * The Dashboard screen (P3-D): period selector, category composition over time, an overall
 * trend line, top merchants, the most recent period-over-period change, a per-user comparison
 * when more than one user exists, and the D5 mixed-currency banner. Every chart degrades to an
 * `EmptyState` before any data exists, rather than rendering an empty axis.
 */
export default function DashboardScreen() {
  const [params, setParams] = useSpendQueryParams();
  const usersQuery = useUsers();
  const accountsQuery = useAccounts();

  const granularity = params.granularity ?? "month";
  const currency = params.currency ?? "USD";

  const filters: DashboardFilters = React.useMemo(
    () => ({
      userIds: params.userIds,
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      currency,
    }),
    [params.userIds, params.dateFrom, params.dateTo, currency],
  );

  const users = usersQuery.data ?? [];
  const showUserComparison = users.length > 1;

  const categoryQuery = useCategoryBreakdown(filters, granularity);
  const trendQuery = useTrend(filters, granularity);
  const topMerchantsQuery = useTopMerchants(filters);
  const userBreakdownQuery = useUserBreakdown(filters, showUserComparison);

  const dateRange: DateRange = { from: params.dateFrom ?? null, to: params.dateTo ?? null };

  const currencyOptions = React.useMemo(() => {
    const set = new Set<string>([currency]);
    for (const account of accountsQuery.data ?? []) set.add(account.currency);
    return Array.from(set).sort();
  }, [accountsQuery.data, currency]);

  const otherCurrencies = React.useMemo(
    () => detectOtherCurrencies(accountsQuery.data ?? [], currency),
    [accountsQuery.data, currency],
  );

  const trendPoints = React.useMemo(() => toTrendPoints(trendQuery.data ?? []), [trendQuery.data]);
  const monthOverMonth = React.useMemo(() => computeMonthOverMonthDelta(trendPoints), [trendPoints]);
  const userTotals = React.useMemo(() => totalsByUser(userBreakdownQuery.data ?? []), [userBreakdownQuery.data]);

  const anyError = categoryQuery.error ?? trendQuery.error ?? topMerchantsQuery.error;
  const anyLoading =
    categoryQuery.isLoading || trendQuery.isLoading || topMerchantsQuery.isLoading || usersQuery.isLoading;

  const hasAnyData =
    (categoryQuery.data?.length ?? 0) > 0 ||
    (trendQuery.data?.length ?? 0) > 0 ||
    (topMerchantsQuery.data?.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6 py-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Spending by category over time, top merchants, and how this period compares to the last.
        </p>
      </div>

      <FiltersBar
        dateRange={dateRange}
        onDateRangeChange={(range) => setParams({ dateFrom: range.from ?? undefined, dateTo: range.to ?? undefined })}
        granularity={granularity}
        onGranularityChange={(g) => setParams({ granularity: g })}
        users={users}
        selectedUserIds={params.userIds}
        onSelectedUserIdsChange={(userIds) => setParams({ userIds })}
        currency={currency}
        currencyOptions={currencyOptions}
        onCurrencyChange={(c) => setParams({ currency: c })}
      />

      <CurrencyBanner currencies={otherCurrencies} selectedCurrency={currency} />

      {anyError ? (
        <ErrorState description={anyError instanceof Error ? anyError.message : String(anyError)} />
      ) : anyLoading ? (
        <LoadingState rows={4} />
      ) : !hasAnyData ? (
        <EmptyState
          title="No data yet"
          description="Import a statement and classify its transactions to see your dashboard."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Spending by category</CardTitle>
            </CardHeader>
            <CardContent>
              <CategoryStackedBar rows={categoryQuery.data ?? []} currency={currency} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <TrendLine rows={trendQuery.data ?? []} currency={currency} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>This period vs. last</CardTitle>
            </CardHeader>
            <CardContent>
              <MonthOverMonth delta={monthOverMonth} currency={currency} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top merchants</CardTitle>
            </CardHeader>
            <CardContent>
              <TopMerchants rows={topMerchantsQuery.data ?? []} currency={currency} />
            </CardContent>
          </Card>

          {showUserComparison ? (
            <Card>
              <CardHeader>
                <CardTitle>By user</CardTitle>
              </CardHeader>
              <CardContent>
                {userBreakdownQuery.isLoading ? (
                  <LoadingState rows={2} />
                ) : (
                  <UserComparison totals={userTotals} users={users} currency={currency} />
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}

export const screenMeta = { path: "/", title: "Dashboard" };
