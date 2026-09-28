import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/primitives/states";

import { colorForKey } from "../chart-colors";
import { distinctCategories, pivotByCategory, type AnalyticsRow } from "../logic";

export interface CategoryStackedBarProps {
  rows: readonly AnalyticsRow[];
  currency: string;
}

function formatPeriodTick(period: string): string {
  return period === "all" || period === "unknown" ? period : period;
}

function currencyFormatter(currency: string) {
  const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
  return (minorUnits: number) => formatter.format(minorUnits / 100);
}

/**
 * A stacked bar per period, one segment per category — spend composition over time. Money is
 * signed minor units (I5); a category with net-negative spend in a period (more refunds than
 * purchases) renders below the axis, which Recharts handles natively for a stacked bar.
 *
 * `isAnimationActive={false}`: Recharts' default entrance animation grows each bar from zero
 * over ~1.5s. On a same-session SPA route change (e.g. arriving here right after an import) the
 * final, correct bar heights only appear once that animation settles — anything read from the
 * screen before then (a screenshot, a scripted test, a person glancing over) sees a transient,
 * *wrong* total. Numbers this load-bearing should be right the instant the chart mounts.
 */
export function CategoryStackedBar({ rows, currency }: CategoryStackedBarProps) {
  const points = React.useMemo(() => pivotByCategory(rows), [rows]);
  const categories = React.useMemo(() => distinctCategories(points), [points]);
  const format = React.useMemo(() => currencyFormatter(currency), [currency]);

  if (points.length === 0) {
    return (
      <EmptyState
        title="No spending yet"
        description="Import and classify a statement to see spending by category over time."
      />
    );
  }

  const data = points.map((point) => ({ period: point.period, ...point.categories }));

  return (
    <div className="h-72 w-full" data-testid="category-stacked-bar">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="period" tickFormatter={formatPeriodTick} fontSize={12} />
          <YAxis tickFormatter={(v: number) => format(v)} width={80} fontSize={12} />
          <Tooltip
            formatter={(value: number, name: string) => [format(value), name]}
            labelFormatter={(label: string) => `Period: ${label}`}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {categories.map((category) => (
            <Bar
              key={category}
              dataKey={category}
              stackId="spend"
              fill={colorForKey(category)}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
