import { DateRangePicker, type DateRange } from "@/components/primitives/date-range-picker";
import { cn } from "@/utils";

import type { User } from "../logic";

type Granularity = "day" | "week" | "month" | "quarter" | "year" | "all";

const GRANULARITIES: readonly Granularity[] = ["day", "week", "month", "quarter", "year", "all"];

export interface FiltersBarProps {
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  granularity: Granularity;
  onGranularityChange: (granularity: Granularity) => void;
  users: readonly User[];
  selectedUserIds: readonly number[] | undefined;
  onSelectedUserIdsChange: (userIds: number[] | undefined) => void;
  currency: string;
  currencyOptions: readonly string[];
  onCurrencyChange: (currency: string) => void;
}

const selectClassName =
  "flex h-9 items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The dashboard's period selector: date range, bucket granularity, currency, and (only when
 * more than one user exists) a user filter. All of it round-trips through the URL via
 * `useSpendQueryParams` at the call site, so a filtered view is bookmarkable. */
export function FiltersBar({
  dateRange,
  onDateRangeChange,
  granularity,
  onGranularityChange,
  users,
  selectedUserIds,
  onSelectedUserIdsChange,
  currency,
  currencyOptions,
  onCurrencyChange,
}: FiltersBarProps) {
  const toggleUser = (userId: number) => {
    const current = new Set(selectedUserIds ?? []);
    if (current.has(userId)) {
      current.delete(userId);
    } else {
      current.add(userId);
    }
    onSelectedUserIdsChange(current.size === 0 ? undefined : Array.from(current));
  };

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

      {users.length > 1 ? (
        <fieldset className="flex flex-col gap-1 text-xs text-muted-foreground">
          <legend>Users</legend>
          <div className="flex flex-wrap gap-2">
            {users.map((user) => {
              const checked = selectedUserIds ? selectedUserIds.includes(user.id) : true;
              return (
                <label key={user.id} className="flex items-center gap-1.5 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleUser(user.id)}
                  />
                  {user.name}
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : null}
    </div>
  );
}
