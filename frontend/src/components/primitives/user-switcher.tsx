import * as React from "react";

import type { components } from "@/api/client";
import { cn } from "@/utils";

type User = components["schemas"]["User"];

export interface UserSwitcherProps {
  users: readonly User[];
  /** Selected user id, or `null` for "All users". */
  value: number | null;
  onChange: (id: number | null) => void;
  allLabel?: string;
  /** Whether the "All users" option exists (false for forms that need one concrete user). */
  allowAll?: boolean;
  /** `auto` renders chips, falling back to a `<select>` when there are more than 6 users. */
  variant?: "auto" | "chips" | "select";
  className?: string;
  "aria-label"?: string;
}

const MAX_CHIPS = 6;

/**
 * Presentational user picker: tab-like chips ("All users" first) or a native select for many
 * users. Renders nothing when there is at most one user (nothing to switch between).
 */
export function UserSwitcher({
  users,
  value,
  onChange,
  allLabel = "All users",
  allowAll = true,
  variant = "auto",
  className,
  "aria-label": ariaLabel = "User",
}: UserSwitcherProps) {
  const options = React.useMemo(
    () => [
      ...(allowAll ? [{ id: null as number | null, label: allLabel }] : []),
      ...users.map((u) => ({ id: u.id, label: u.name })),
    ],
    [users, allowAll, allLabel],
  );
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);

  if (users.length <= 1) return null;

  const useSelect = variant === "select" || (variant === "auto" && users.length > MAX_CHIPS);

  if (useSelect) {
    return (
      <select
        data-testid="user-switcher"
        aria-label={ariaLabel}
        className={cn(
          "flex h-9 items-center rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
        value={value === null ? "all" : String(value)}
        onChange={(e) => onChange(e.target.value === "all" ? null : Number(e.target.value))}
      >
        {options.map((o) => (
          <option key={o.id ?? "all"} value={o.id === null ? "all" : String(o.id)}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  const activeIndex = Math.max(
    options.findIndex((o) => o.id === value),
    0,
  );

  function onKeyDown(event: React.KeyboardEvent, index: number) {
    let target = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") target = (index + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") target = (index - 1 + options.length) % options.length;
    else return;
    event.preventDefault();
    onChange(options[target]!.id);
    refs.current[target]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid="user-switcher"
      className={cn("inline-flex flex-wrap items-center gap-1 rounded-full bg-muted p-1", className)}
    >
      {options.map((o, i) => {
        const checked = o.id === value;
        return (
          <button
            key={o.id ?? "all"}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={i === activeIndex ? 0 : -1}
            onClick={() => onChange(o.id)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              checked
                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
