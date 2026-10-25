import { DateRangePicker, type DateRange } from "@/components/primitives/date-range-picker";
import { cn } from "@/utils";

type Granularity = "day" | "week" | "month" | "quarter" | "year" | "all";

const GRANULARITIES: readonly Granularity[] = ["day", "week", "month", "quarter", "year", "all"];

export interface FiltersBarProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
  currency: string;
  currencyOptions: readonly string[];
  onCurrencyChange: (currency: string) => void;
}

const selectClassName =
  "flex h-9 items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The dashboard's period selector: date range, bucket granularity, and currency (the user
 * view is the page-level `UserSwitcher`). All of it round-trips through the URL via
 * `useSpendQueryParams` at the call site, so a filtered view is bookmarkable. */
export function FiltersBar({
  dateRange,
  onDateRangeChange,
  granularity,
  onGranularityChange,
  currency,
  currencyOptions,
  onCurrencyChange,
}: FiltersBarProps) {
  return (
    <div className="flex flex-wrap items-start gap-4">
      <DateRangePicker value={dateRange} onChange={onDateRangeChange} />

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Granularity
        <select
          aria-label="Granularity"
          className={cn(selectClassName, "w-32")}
          value={granularity}
          onChange={(e) => onGranularityChange(e.target.value as Granularity)}
        >
          {GRANULARITIES.map((g) => (
            <option key={g} value={g}>
              {g[0]!.toUpperCase() + g.slice(1)}
            </option>
          ))}
        </select>
      </label>

      {currencyOptions.length > 1 ? (
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Currency
          <select
            aria-label="Currency"
            className={cn(selectClassName, "w-24")}
            value={currency}
            onChange={(e) => onCurrencyChange(e.target.value)}
          >
            {currencyOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  );
}
