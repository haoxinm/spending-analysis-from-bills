import * as React from "react";

import { DateRangePicker, type DateRange } from "@/components/primitives/date-range-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { SpendQueryParams } from "@/hooks/use-spend-query-params";

import { KINDS, type Category } from "./types";

export interface FiltersBarProps {
  filters: SpendQueryParams;
  categories: Category[];
  onChange: (next: Partial<SpendQueryParams>) => void;
}

/** Debounces a free-text input so every keystroke doesn't push a new URL entry / re-fetch. */
function useDebouncedCallback<Args extends unknown[]>(
  fn: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  const fnRef = React.useRef(fn);
  fnRef.current = fn;
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  return React.useCallback(
    (...args: Args) => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => fnRef.current(...args), delayMs);
    },
    [delayMs],
  );
}

/**
 * Faceted filter bar for the transactions grid, bound to `useSpendQueryParams` (URL search
 * params) so a filtered view is always linkable and bookmarkable. Every control is
 * uncontrolled-ish: it holds its own draft state so typing feels instant, and pushes to the
 * URL (which re-triggers the query) only on commit — immediately for a select/checkbox,
 * debounced for free text and numbers.
 */
export function FiltersBar({ filters, categories, onChange }: FiltersBarProps) {
  const [search, setSearch] = React.useState(filters.search ?? "");
  const [amountMin, setAmountMin] = React.useState(
    filters.amountMinMinor !== undefined ? String(filters.amountMinMinor / 100) : "",
  );
  const [amountMax, setAmountMax] = React.useState(
    filters.amountMaxMinor !== undefined ? String(filters.amountMaxMinor / 100) : "",
  );

  const commitSearch = useDebouncedCallback((value: string) => {
    onChange({ search: value || undefined });
  }, 300);

  const commitAmount = useDebouncedCallback((min: string, max: string) => {
    onChange({
      amountMinMinor: min === "" ? undefined : Math.round(Number(min) * 100),
      amountMaxMinor: max === "" ? undefined : Math.round(Number(max) * 100),
    });
  }, 300);

  const dateRange: DateRange = {
    from: filters.dateFrom ?? null,
    to: filters.dateTo ?? null,
  };

  const selectedKinds = new Set(filters.kinds ?? []);
  const selectedCategories = new Set(filters.categoryKeys ?? []);

  function toggleKind(kind: string) {
    const next = new Set(selectedKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    onChange({ kinds: next.size > 0 ? Array.from(next) : undefined });
  }

  function toggleCategory(key: string) {
    const next = new Set(selectedCategories);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange({ categoryKeys: next.size > 0 ? Array.from(next) : undefined });
  }

  const hasFilters =
    filters.search ||
    filters.kinds?.length ||
    filters.categoryKeys?.length ||
    filters.dateFrom ||
    filters.dateTo ||
    filters.amountMinMinor !== undefined ||
    filters.amountMaxMinor !== undefined;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-3" role="search">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Search
          <Input
            value={search}
            placeholder="Description or merchant"
            className="w-56"
            onChange={(e) => {
              setSearch(e.target.value);
              commitSearch(e.target.value);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Min amount
          <Input
            type="number"
            inputMode="decimal"
            className="w-24"
            value={amountMin}
            onChange={(e) => {
              setAmountMin(e.target.value);
              commitAmount(e.target.value, amountMax);
            }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Max amount
          <Input
            type="number"
            inputMode="decimal"
            className="w-24"
            value={amountMax}
            onChange={(e) => {
              setAmountMax(e.target.value);
              commitAmount(amountMin, e.target.value);
            }}
          />
        </label>
        <DateRangePicker
          value={dateRange}
          hidePresets
          onChange={(next) => onChange({ dateFrom: next.from ?? undefined, dateTo: next.to ?? undefined })}
        />
        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSearch("");
              setAmountMin("");
              setAmountMax("");
              onChange({
                search: undefined,
                kinds: undefined,
                categoryKeys: undefined,
                dateFrom: undefined,
                dateTo: undefined,
                amountMinMinor: undefined,
                amountMaxMinor: undefined,
              });
            }}
          >
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by kind">
        <span className="text-xs text-muted-foreground">Kind:</span>
        {KINDS.map((kind) => (
          <Button
            key={kind}
            type="button"
            size="sm"
            variant={selectedKinds.has(kind) ? "default" : "outline"}
            onClick={() => toggleKind(kind)}
            aria-pressed={selectedKinds.has(kind)}
          >
            {kind}
          </Button>
        ))}
      </div>

      {categories.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by category">
          <span className="text-xs text-muted-foreground">Category:</span>
          {categories.map((category) => (
            <Button
              key={category.key}
              type="button"
              size="sm"
              variant={selectedCategories.has(category.key) ? "default" : "outline"}
              onClick={() => toggleCategory(category.key)}
              aria-pressed={selectedCategories.has(category.key)}
            >
              {category.name}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
