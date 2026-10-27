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

import { CHART_INCOME, CHART_TAX, TOOLTIP_STYLE } from "../chart-colors";
import { yearOverYear, type TaxSummary } from "../logic";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});
const compact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

/** Total income vs total tax per year; rendered by the screen only when more than one year exists. */
export function YearOverYear({
  summaries,
}: {
  summaries: readonly TaxSummary[];
}) {
  const points = React.useMemo(() => yearOverYear(summaries), [summaries]);
  const axis = {
    stroke: "hsl(var(--muted-foreground))",
    tick: { fill: "hsl(var(--muted-foreground))" },
    fontSize: 12,
  };
  return (
    <div
      className="h-64 w-full"
      data-testid="year-over-year"
      role="img"
      aria-label={`Income and tax by year: ${points
        .map(
          (p) =>
            `${p.year} income ${usd.format(p.income / 100)}, tax ${usd.format(p.tax / 100)}`,
        )
        .join("; ")}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={points}
          margin={{ top: 8, right: 8, bottom: 0, left: 8 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="hsl(var(--border))"
          />
          <XAxis dataKey="year" {...axis} />
          <YAxis
            tickFormatter={(v: number) => compact.format(v / 100)}
            width={72}
            {...axis}
          />
          <Tooltip
            formatter={(value: number, name: string) => [
              usd.format(value / 100),
              name,
            ]}
            contentStyle={TOOLTIP_STYLE}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="income"
            name="Total income"
            fill={CHART_INCOME}
            isAnimationActive={false}
          />
          <Bar
            dataKey="tax"
            name="Total tax"
            fill={CHART_TAX}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
