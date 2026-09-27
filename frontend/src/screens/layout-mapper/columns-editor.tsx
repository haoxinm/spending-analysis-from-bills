import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { COLUMN_TYPES, MONEY_ROLES, emptyColumn, type ColumnSpec, type SpecFieldError } from "./spec-types";

/**
 * Manual column mapper (§2d.2 "click-to-map columns", degraded to typed x-bands — see this WP's
 * report on the missing statement-preview/word-coordinate endpoint that a true click UI needs).
 * Each row is one `ColumnSpec`: name, x0/x1 (PDF points, read off the statement by eye or from a
 * PDF viewer's ruler), type, and the type-specific extras (date formats, multiline, role).
 */
export function ColumnsEditor({
  columns,
  onChange,
  errors,
}: {
  columns: ColumnSpec[];
  onChange: (columns: ColumnSpec[]) => void;
  errors: SpecFieldError[];
}) {
  function update(index: number, patch: Partial<ColumnSpec>): void {
    onChange(columns.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function remove(index: number): void {
    onChange(columns.filter((_, i) => i !== index));
  }

  function errorsFor(index: number): SpecFieldError[] {
    return errors.filter((e) => e.field === `columns[${index}]` || e.field.startsWith(`columns[${index}].`));
  }

  return (
    <div className="flex flex-col gap-3">
      {errors.filter((e) => e.field === "columns").map((e) => (
        <p key={e.message} className="text-xs text-destructive">
          {e.message}
        </p>
      ))}
      {columns.map((col, i) => {
        const rowErrors = errorsFor(i);
        return (
          <div key={i} className="flex flex-col gap-2 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Name">
                <Input
                  value={col.name}
                  placeholder="posted_date"
                  onChange={(e) => update(i, { name: e.target.value })}
                  className="w-40"
                />
              </Field>
              <Field label="x0 (pt)">
                <Input
                  type="number"
                  value={col.x0}
                  onChange={(e) => update(i, { x0: Number(e.target.value) })}
                  className="w-24"
                />
              </Field>
              <Field label="x1 (pt)">
                <Input
                  type="number"
                  value={col.x1}
                  onChange={(e) => update(i, { x1: Number(e.target.value) })}
                  className="w-24"
                />
              </Field>
              <Field label="Type">
                <select
                  value={col.type}
                  onChange={(e) => update(i, { type: e.target.value as ColumnSpec["type"] })}
                  className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  {COLUMN_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
              {col.type === "date" ? (
                <Field label="Date format">
                  <Input
                    value={col.formats?.[0] ?? ""}
                    placeholder="%m/%d"
                    onChange={(e) => update(i, { formats: [e.target.value] })}
                    className="w-28"
                  />
                </Field>
              ) : null}
              {col.type === "money" ? (
                <Field label="Role">
                  <select
                    value={col.role ?? "amount"}
                    onChange={(e) =>
                      update(i, { role: e.target.value === "amount" ? undefined : (e.target.value as ColumnSpec["role"]) })
                    }
                    className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
                  >
                    <option value="amount">amount (single column)</option>
                    {MONEY_ROLES.filter((r) => r !== "amount").map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {col.type === "text" ? (
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={col.multiline ?? false}
                    onChange={(e) => update(i, { multiline: e.target.checked })}
                  />
                  multiline
                </label>
              ) : null}
              <label className="flex items-center gap-1 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={col.optional ?? false}
                  onChange={(e) => update(i, { optional: e.target.checked })}
                />
                optional
              </label>
              <Button variant="ghost" size="sm" onClick={() => remove(i)} aria-label={`Remove column ${col.name || i}`}>
                Remove
              </Button>
            </div>
            {rowErrors.map((e) => (
              <p key={e.field + e.message} className="text-xs text-destructive">
                {e.field}: {e.message}
              </p>
            ))}
          </div>
        );
      })}
      <Button variant="outline" size="sm" onClick={() => onChange([...columns, emptyColumn()])}>
        Add column
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
