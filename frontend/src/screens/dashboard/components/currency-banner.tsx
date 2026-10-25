import { Badge } from "@/components/ui/badge";

export interface CurrencyBannerProps {
  /** Other currencies present among accounts in scope, outside the current filter (D5). */
  currencies: readonly string[];
  selectedCurrency: string;
}

/**
 * D5: "Never convert. Aggregations filter to a single posted currency... the UI banners when
 * other currencies exist outside the filter." This never sums across currencies — it only says
 * so, so a user with a EUR account is not silently under-counted while looking at a USD total.
 */
export function CurrencyBanner({ currencies, selectedCurrency }: CurrencyBannerProps) {
  if (currencies.length === 0) return null;

  return (
    <div
      role="status"
      data-testid="currency-banner"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
    >
      <span>
        Showing totals in <strong>{selectedCurrency}</strong> only. Not included:
      </span>
      {currencies.map((currency) => (
        <Badge key={currency} variant="outline" className="border-amber-400 text-amber-900 dark:text-amber-200">
          {currency}
        </Badge>
      ))}
      <span className="text-amber-800/80 dark:text-amber-300/80">
        (amounts are never converted between currencies)
      </span>
    </div>
  );
}
