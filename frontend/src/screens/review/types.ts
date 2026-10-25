import type { components } from "@/api/client";

export type Transaction = components["schemas"]["Transaction"];
export type Category = components["schemas"]["Category"];
export type Subcategory = components["schemas"]["Subcategory"];

/** A flattened `(category, subcategory)` pair, for the numbered quick-pick list (§P3-B). */
export interface CategoryChoice {
  categoryKey: string;
  categoryLabel: string;
  subcategoryKey: string;
  subcategoryLabel: string;
}

/** One entry of the undo stack: enough of the transaction's prior state to PATCH it back. */
export interface UndoEntry {
  transactionId: number;
  previousCategoryKey: string | null;
  previousSubcategoryKey: string | null;
  previousKind: Transaction["kind"];
  /** Where the transaction sat in the visible queue, so undo re-inserts it in place. */
  queueIndex: number;
  transactionSnapshot: Transaction;
}
