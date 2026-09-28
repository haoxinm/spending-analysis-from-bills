import { EmptyState } from "@/components/primitives/states";
import { Money } from "@/components/primitives/money";

import { humanizeMerchantKey, type TopMerchantRow } from "../logic";

export interface TopMerchantsProps {
  rows: readonly TopMerchantRow[];
  currency: string;
}

/** A ranked list, widest-spend first (already ranked server-side, §3.12), with a proportional
 * bar so relative size reads at a glance without another chart library primitive.
 *
 * `row.merchant` is the raw `merchant_key` — lowercase and, once truncated to fit, sometimes
 * unrecognisable (e.g. "hardware sup…"). `humanizeMerchantKey` title-cases it for display; the
 * full raw key is still there as this label's `title`, so hovering (or a screen reader's
 * description) recovers exactly what's on the statement. */
export function TopMerchants({ rows, currency }: TopMerchantsProps) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No merchants yet"
        description="Top merchants will appear here once transactions are classified."
      />
    );
  }

  const maxMinor = Math.max(...rows.map((row) => Math.abs(row.total_minor)), 1);

  return (
    <ul className="flex flex-col gap-2" data-testid="top-merchants">
      {rows.map((row) => (
        <li key={row.merchant} className="flex items-center gap-3">
          <div className="w-28 flex-shrink-0 truncate text-sm font-medium" title={row.merchant}>
            {humanizeMerchantKey(row.merchant)}
          </div>
          <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-outflow"
              style={{ width: `${(Math.abs(row.total_minor) / maxMinor) * 100}%` }}
            />
          </div>
          <Money minorUnits={row.total_minor} currency={currency} className="w-20 flex-shrink-0 text-right text-sm" />
          <span className="w-14 flex-shrink-0 text-right text-xs text-muted-foreground">
            {row.txn_count} txn{row.txn_count === 1 ? "" : "s"}
          </span>
        </li>
      ))}
    </ul>
  );
}
