import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { EmptyState } from "@/components/primitives/states";

import { CHART_OUTFLOW } from "../chart-colors";
import { toTrendPoints, type AnalyticsRow } from "../logic";

export interface TrendLineProps {
  rows: readonly AnalyticsRow[];
  currency: string;
}

/** The overall spend trend across periods — one line, net of refunds per the query's own
 * `net_refunds` default (A7), so this reads as "money that actually left" per period. */
export function TrendLine({ rows, currency }: TrendLineProps) {
  const points = React.useMemo(() => toTrendPoints(rows), [rows]);
  const format = React.useMemo(() => {
    const formatter = new Intl.NumberFormat("en-US", { style: "currency", currency });
    return (minorUnits: number) => formatter.format(minorUnits / 100);
  }, [currency]);

  if (points.length === 0) {
    return (
      <EmptyState title="No trend yet" description="Spending totals will appear here once classified." />
    );
  }

  return (
    <div className="h-56 w-full" data-testid="trend-line">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
          <XAxis dataKey="period" fontSize={12} />
          <YAxis tickFormatter={(v: number) => format(v)} width={80} fontSize={12} />
          <Tooltip
            formatter={(value: number) => [format(value), "Total"]}
            labelFormatter={(label: string) => `Period: ${label}`}
          />
          <Line
            type="monotone"
            dataKey="totalMinor"
            stroke={CHART_OUTFLOW}
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
