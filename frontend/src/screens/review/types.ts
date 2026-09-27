import type { components } from "@/api/client";

export type Transaction = components["schemas"]["Transaction"];
export type Category = components["schemas"]["Category"];
export type Subcategory = components["schemas"]["Subcategory"];

/**
 * `Subcategory` as the API contract stands today has no numeric id, only its stable `key`
 * (§3.12's `Category`/`Subcategory` schemas). The approve/merge endpoints
 * (`/taxonomy/subcategories/{subcategory_id}/...`) take that numeric id, which nothing on the
 * wire ever gives the frontend — a contract gap reported alongside this WP (see the review
 * screen's module doc in `index.tsx`). This type documents the field defensively: if a future
 * backend adds `id` to the `Subcategory` response, the pending-stores panel picks it up with no
 * frontend change, because the check is a runtime `typeof` guard, not a type assertion.
 */
export type SubcategoryWithOptionalId = Subcategory & { id?: number };

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
