import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  KIND_HINTS,
  SECTIONS_MODES,
  type SectionPatternSpec,
  type SectionsSpec,
  type SpecFieldError,
} from "./spec-types";

/** Section-boundary marking (§2d.2): heading patterns with a kind hint, an optional terminator,
 * and tables to exclude from parsing entirely (e.g. an "INTEREST CHARGED" recap table). */
export function SectionsEditor({
  sections,
  onChange,
  errors,
}: {
  sections: SectionsSpec;
  onChange: (sections: SectionsSpec) => void;
  errors: SpecFieldError[];
}) {
  const patterns = sections.patterns ?? [];
  const excludeTables = sections.exclude_tables ?? [];

  function updatePattern(index: number, patch: Partial<SectionPatternSpec>): void {
    onChange({ ...sections, patterns: patterns.map((p, i) => (i === index ? { ...p, ...patch } : p)) });
  }

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Mode
        <select
          value={sections.mode ?? "heading"}
          onChange={(e) => onChange({ ...sections, mode: e.target.value as SectionsSpec["mode"] })}
          className="h-9 w-56 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          {SECTIONS_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>

      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted-foreground">Section heading patterns</p>
        {patterns.map((p, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Input
              value={p.match}
              placeholder="PURCHASES"
              onChange={(e) => updatePattern(i, { match: e.target.value })}
              className="w-64"
            />
            <select
              value={p.kind_hint ?? ""}
              onChange={(e) =>
                updatePattern(i, { kind_hint: e.target.value === "" ? undefined : (e.target.value as never) })
              }
              className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
            >
              <option value="">(no plain kind_hint)</option>
              {KIND_HINTS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ ...sections, patterns: patterns.filter((_, idx) => idx !== i) })}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange({ ...sections, patterns: [...patterns, { match: "", kind_hint: "purchase" }] })}
        >
          Add section pattern
        </Button>
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Terminator (regex, optional — e.g. the "TOTAL ... FOR THIS PERIOD" line)
        <Input
          value={sections.terminator ?? ""}
          onChange={(e) => onChange({ ...sections, terminator: e.target.value || undefined })}
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Excluded tables (comma-separated headings, e.g. "INTEREST CHARGED")
        <Input
          value={excludeTables.join(", ")}
          onChange={(e) =>
            onChange({
              ...sections,
              exclude_tables: e.target.value
                .split(",")
                .map((t) => t.trim())
                .filter((t) => t.length > 0),
            })
          }
        />
      </label>

      {errors
        .filter((e) => e.field.startsWith("sections"))
        .map((e) => (
          <p key={e.field + e.message} className="text-xs text-destructive">
            {e.field}: {e.message}
          </p>
        ))}
    </div>
  );
}
