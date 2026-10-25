import { cn } from "@/utils";

export interface YearPickerProps {
  years: readonly number[];
  value: number | null;
  onChange: (year: number) => void;
}

/** Tab-like chips, newest year first. */
export function YearPicker({ years, value, onChange }: YearPickerProps) {
  if (years.length === 0) return null;
  return (
    <div
      role="radiogroup"
      aria-label="Tax year"
      data-testid="year-picker"
      className="inline-flex flex-wrap items-center gap-1 rounded-full bg-muted p-1"
    >
      {years.map((y) => (
        <button
          key={y}
          type="button"
          role="radio"
          aria-checked={y === value}
          onClick={() => onChange(y)}
          className={cn(
            "rounded-full border px-3 py-1 text-sm font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
