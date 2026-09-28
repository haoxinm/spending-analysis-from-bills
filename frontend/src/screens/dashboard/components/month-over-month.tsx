import { Money } from "@/components/primitives/money";
import { EmptyState } from "@/components/primitives/states";

import type { MonthOverMonthDelta } from "../logic";

export interface MonthOverMonthProps {
  delta: MonthOverMonthDelta | null;
  currency: string;
}

/** The change between the two most recent periods in the current trend series. The label says
 * "period" rather than "month" because `granularity` may be day/week/quarter/year — this panel
 * follows whatever bucket the rest of the dashboard is using.
 *
 * A lower spend reads as good news throughout: the arrow, its colour and the delta amount's
 * sign all agree, in both directions. `deltaMinor` is `current - previous`, where both totals
 * are already positive (outflow) sums — so a *negative* `deltaMinor` means spend fell. Passing
 * it straight to `<Money>` (with no `showPlusForInflow` override) gets this right for free: `I5`
 * already treats a negative amount as "inflow" (a good-news green, and a plain `-` sign, not a
 * `+`) and a positive one as "outflow" (red, no sign) — which is exactly "spend fell" / "spend
 * rose" here, so the arrow's own `increased` check can reuse the same two classes. The previous
 * version passed `showPlusForInflow`, which put a `+` in front of a *decrease* while the arrow
 * and percentage both read as "less" — a direct contradiction (e.g. "▼ +$98.05 (-65.4%)"). */
export function MonthOverMonth({ delta, currency }: MonthOverMonthProps) {
  if (!delta) {
    return (
      <EmptyState
        title="Not enough history yet"
        description="At least two periods of data are needed to show a change."
      />
    );
  }

  const increased = delta.deltaMinor > 0;
  const unchanged = delta.deltaMinor === 0;

  return (
    <div className="flex flex-col gap-3" data-testid="month-over-month">
      <div className="flex items-baseline gap-2">
        <Money minorUnits={delta.currentMinor} currency={currency} className="text-2xl font-semibold" />
        <span className="text-xs text-muted-foreground">this {delta.currentPeriod}</span>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span
          aria-hidden="true"
          className={unchanged ? "text-muted-foreground" : increased ? "text-outflow" : "text-inflow"}
        >
          {unchanged ? "→" : increased ? "▲" : "▼"}
        </span>
        <Money minorUnits={delta.deltaMinor} currency={currency} className="font-medium" />
        <span className="text-muted-foreground">
          {delta.deltaPct === null
            ? `vs. ${delta.previousPeriod} (no prior spend)`
            : `(${(delta.deltaPct * 100).toFixed(1)}%) vs. ${delta.previousPeriod}`}
        </span>
      </div>
    </div>
  );
}
