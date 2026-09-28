import { apiClient, throwIfError, type components } from "@/api/client";

import type { Transaction } from "./types";

export type TransactionPatchBody = components["schemas"]["TransactionPatch"];

/**
 * The largest page the backend will hand back in one request (`crud.list_transactions` clamps
 * `page_size` to 500, §3.12 `/transactions`).
 */
const PAGE_SIZE = 500;

/**
 * A hard ceiling on how many pages this screen will fetch when building the review queue.
 * 50 pages * 500 rows = 25,000 transactions, comfortably past what a single-user local install
 * accumulates before this stops being "the whole queue".
 */
const MAX_PAGES = 50;

/**
 * Fetches every `needs_review` transaction, oldest first, via `GET /transactions?needs_review=true`
 * (with `include_non_spend: true` so a low-confidence payment or transfer is never silently
 * skipped), paging server-side until a short page signals the last one.
 */
export async function fetchNeedsReviewQueue(): Promise<Transaction[]> {
  const collected: Transaction[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const { data, error } = await apiClient.GET("/transactions", {
      params: {
        query: {
          page,
          page_size: PAGE_SIZE,
          sort: "posted_date",
          include_non_spend: true,
          needs_review: true,
        },
      },
    });
    throwIfError(error);
    if (!data) break;
    collected.push(...data.items);
    if (data.items.length < PAGE_SIZE) break; // last page
  }
  return collected;
}

/**
 * `PATCH /transactions/{id}` (§3.12). A `category_key`/`subcategory_key` pair routes through
 * `apply_user_correction` server-side, which both clears `needs_review` and writes
 * `merchant_map(source='user')` (I6) — this is what "accept" and "undo" both call.
 */
export async function patchTransaction(
  id: number,
  body: TransactionPatchBody,
): Promise<Transaction> {
  const { data, error } = await apiClient.PATCH("/transactions/{id}", {
    params: { path: { id } },
    body,
  });
  throwIfError(error);
  if (!data) throw new Error(`PATCH /transactions/${id} returned no body`);
  return data;
}
