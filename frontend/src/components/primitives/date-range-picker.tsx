import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/utils";

export interface DateRange {
  from: string | null; // ISO date (yyyy-mm-dd), inclusive
  to: string | null; // ISO date (yyyy-mm-dd), inclusive
}

export interface DateRangePickerProps {
  value: DateRange;
  onChange: (next: DateRange) => void;
  className?: string;
  /** Disables the preset row, for a compact inline placement. */
  hidePresets?: boolean;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d: Date): Date {
  return new Date(d.getFullYear(), 0, 1);
}

function daysAgo(n: number, from: Date): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - n);
  return d;
}

interface Preset {
  label: string;
  range: () => DateRange;
}

function buildPresets(): Preset[] {
  const now = new Date();
  return [
    { label: "Last 7 days", range: () => ({ from: isoDate(daysAgo(7, now)), to: isoDate(now) }) },
    { label: "Last 30 days", range: () => ({ from: isoDate(daysAgo(30, now)), to: isoDate(now) }) },
    { label: "Last 90 days", range: () => ({ from: isoDate(daysAgo(90, now)), to: isoDate(now) }) },
    { label: "This month", range: () => ({ from: isoDate(startOfMonth(now)), to: isoDate(now) }) },
    { label: "This year", range: () => ({ from: isoDate(startOfYear(now)), to: isoDate(now) }) },
    { label: "All time", range: () => ({ from: null, to: null }) },
  ];
}

/**
 * A `SpendQuery.date_from` / `date_to` picker (§3.9): two native date inputs plus common
 * presets. Deliberately not a calendar-grid widget — a personal-finance date range is almost
 * always "last N days" or "this period", which a preset answers in one click, and a native
 * `<input type="date">` is fully accessible and keyboard-operable without a third-party
 * calendar dependency.
 */
export function DateRangePicker({ value, onChange, className, hidePresets }: DateRangePickerProps) {
  const presets = React.useMemo(buildPresets, []);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          From
          <Input
            type="date"
            aria-label="Date from"
            value={value.from ?? ""}
            max={value.to ?? undefined}
            onChange={(e) => onChange({ ...value, from: e.target.value || null })}
            className="w-36"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          To
          <Input
            type="date"
            aria-label="Date to"
            value={value.to ?? ""}
            min={value.from ?? undefined}
            onChange={(e) => onChange({ ...value, to: e.target.value || null })}
            className="w-36"
          />
        </label>
      </div>
      {hidePresets ? null : (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Date range presets">
          {presets.map((preset) => (
            <Button
              key={preset.label}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onChange(preset.range())}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
