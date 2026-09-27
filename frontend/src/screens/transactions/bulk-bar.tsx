import * as React from "react";

import { Button } from "@/components/ui/button";

import type { Category, Kind } from "./types";

export interface BulkBarProps {
  selectedCount: number;
  totalMatching: number;
  loadedCount: number;
  categories: Category[];
  onSelectAllMatching: () => void;
  onClear: () => void;
  onApply: (patch: { categoryKey: string; subcategoryKey: string; kind?: Kind }) => void;
  applying?: boolean;
  selectingAll?: boolean;
}

/**
 * The bulk-relabel bar: appears once at least one row is selected, and applies one label to
 * every selected transaction via `POST /transactions/bulk-update` (§3.12). "Select all N
 * matching filters" resolves the *whole* filtered set into ids first (`useAllMatchingIds`) —
 * without it, a selection could only ever cover what has scrolled into memory so far.
 */
export function BulkBar({
  selectedCount,
  totalMatching,
  loadedCount,
  categories,
  onSelectAllMatching,
  onClear,
  onApply,
  applying,
  selectingAll,
}: BulkBarProps) {
  const [categoryKey, setCategoryKey] = React.useState("");
  const [subcategoryKey, setSubcategoryKey] = React.useState("");

  if (selectedCount === 0) return null;

  const selectedCategory = categories.find((c) => c.key === categoryKey);
  const canApply = categoryKey !== "" && subcategoryKey !== "" && !applying;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3">
      <span className="text-sm font-medium">
        {selectedCount} selected
        {totalMatching > loadedCount && selectedCount < totalMatching ? (
          <Button type="button" variant="link" size="sm" onClick={onSelectAllMatching} disabled={selectingAll}>
            {selectingAll ? "Selecting…" : `Select all ${totalMatching} matching filters`}
          </Button>
        ) : null}
      </span>

      <select
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        value={categoryKey}
        onChange={(e) => {
          setCategoryKey(e.target.value);
          setSubcategoryKey("");
        }}
        aria-label="Bulk category"
      >
        <option value="">Category…</option>
        {categories.map((category) => (
          <option key={category.key} value={category.key}>
            {category.name}
          </option>
        ))}
      </select>
      <select
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        value={subcategoryKey}
        onChange={(e) => setSubcategoryKey(e.target.value)}
        disabled={!selectedCategory}
        aria-label="Bulk subcategory"
      >
        <option value="">Subcategory…</option>
        {selectedCategory?.subcategories.map((subcategory) => (
          <option key={subcategory.key} value={subcategory.key}>
            {subcategory.name}
          </option>
        ))}
      </select>

      <Button
        type="button"
        size="sm"
        disabled={!canApply}
        onClick={() => onApply({ categoryKey, subcategoryKey })}
      >
        {applying ? "Applying…" : `Apply to ${selectedCount}`}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
