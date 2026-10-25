import type { ImportItem } from "./types";

export interface SummaryBarProps {
  items: ImportItem[];
}

/** The "3 statements imported · 412 new transactions · 38 need review" line the plan asks for.
 * Renders nothing until at least one statement has finished importing. The needs-review clause
 * is shown only once at least one parsed item has a count (`fetchNeedsReviewCount`'s best-effort
 * result); see that function's docstring for why the count can lag or be approximate. */
export function SummaryBar({ items }: SummaryBarProps) {
  const parsed = items.filter((item) => item.status === "parsed");
  if (parsed.length === 0) return null;

  const newTransactions = parsed.reduce((sum, item) => sum + (item.statement?.txn_count ?? 0), 0);
  const knownReviewCounts = parsed.filter((item) => item.needsReviewCount !== undefined);
  const needsReview = knownReviewCounts.reduce((sum, item) => sum + (item.needsReviewCount ?? 0), 0);

  const parts = [
    `${parsed.length} statement${parsed.length === 1 ? "" : "s"} imported`,
    `${newTransactions} new transaction${newTransactions === 1 ? "" : "s"}`,
  ];
  if (knownReviewCounts.length === parsed.length) {
    parts.push(`${needsReview} need review`);
  }

  return (
    <p className="text-sm font-medium text-foreground" role="status">
      {parts.join(" · ")}
    </p>
  );
}
