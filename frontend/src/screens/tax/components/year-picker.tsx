import * as React from "react";

import { cn } from "@/utils";

export interface YearPickerProps {
  years: readonly number[];
  value: number | null;
  onChange: (year: number) => void;
}

/** Tab-like chips, newest year first. Radio-group semantics: one tab stop, arrows move selection. */
export function YearPicker({ years, value, onChange }: YearPickerProps) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  if (years.length === 0) return null;

  const activeIndex = Math.max(years.indexOf(value as number), 0);

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    let target: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = (index + 1) % years.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = (index - 1 + years.length) % years.length;
    else return;
    event.preventDefault();
    onChange(years[target]!);
    refs.current[target]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tax year"
      data-testid="year-picker"
      className="inline-flex flex-wrap items-center gap-1 rounded-full bg-muted p-1"
    >
      {years.map((y, i) => (
        <button
          key={y}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={y === value}
          tabIndex={i === activeIndex ? 0 : -1}
          onClick={() => onChange(y)}
          onKeyDown={(e) => onKeyDown(e, i)}
          className={cn(
            "rounded-full border px-3 py-1 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            y === value
              ? "border-primary bg-primary text-primary-foreground shadow-sm"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {y}
        </button>
      ))}
    </div>
  );
}
