import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/utils";

import type { Option } from "../logic";

/** A labelled text input with an optional inline validation message. */
export function TextField({
  label,
  error,
  className,
  inputClassName,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "className"> & {
  label: string;
  error?: string | null;
  className?: string;
  inputClassName?: string;
}) {
  const errorId = React.useId();
  return (
    <label
      className={cn(
        "flex flex-col gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {label}
      <Input
        {...props}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn("h-8", inputClassName)}
      />
      {error ? (
        <span id={errorId} role="alert" className="text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  );
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  disabled,
  placeholder,
}: {
  label: string;
  value: T | "";
  options: readonly Option<T>[];
  onChange: (value: T | "") => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label
      className={cn(
        "flex flex-col gap-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T | "")}
        className="flex h-8 rounded-md border border-input bg-transparent px-2 py-1 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
      >
        {placeholder !== undefined ? (
          <option value="">{placeholder}</option>
        ) : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
