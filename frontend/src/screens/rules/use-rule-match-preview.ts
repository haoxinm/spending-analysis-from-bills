import * as React from "react";

import { useTransactionsForPreview } from "./hooks";
import { ruleMatchesText, validatePattern, type RuleMatchType } from "./rule-matching";

const DEBOUNCE_MS = 300;

export interface RuleMatchPreview {
  /** Number of matches found among the searched transactions. */
  matchCount: number;
  /** How many transactions the preview actually searched. */
  searchedCount: number;
  /** True when `searchedCount` is fewer than the account's total transactions. */
  truncated: boolean;
  loading: boolean;
  /** `undefined` when the pattern is valid for `matchType`. */
  patternError?: string;
}

/**
 * Debounced "this would match N existing transactions" preview for the Rules tab (P3-F
 * acceptance). No dedicated preview endpoint exists (§3.12), so this pulls a bounded, newest-
 * first pool of transactions once (`useTransactionsForPreview`, cached across renders/patterns)
 * and re-filters it in memory against `merchant_key` on every keystroke — cheap, and exactly
 * mirrors the cascade's own matching field (`rule-matching.ts`).
 */
export function useRuleMatchPreview(
  pattern: string,
  matchType: RuleMatchType,
  enabled = true,
): RuleMatchPreview {
  const [debounced, setDebounced] = React.useState(pattern);

  React.useEffect(() => {
    const handle = setTimeout(() => setDebounced(pattern), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [pattern]);

  const validation = validatePattern(debounced, matchType);
  const poolQuery = useTransactionsForPreview(enabled && validation.valid);

  const matchCount = React.useMemo(() => {
    if (!validation.valid || !poolQuery.data) return 0;
    let count = 0;
    for (const txn of poolQuery.data.items) {
      if (!txn.merchant_key) continue;
      if (ruleMatchesText(matchType, debounced, txn.merchant_key)) count += 1;
    }
    return count;
  }, [validation.valid, poolQuery.data, matchType, debounced]);

  return {
    matchCount,
    searchedCount: poolQuery.data?.items.length ?? 0,
    truncated: poolQuery.data?.truncated ?? false,
    loading: enabled && validation.valid && poolQuery.isLoading,
    patternError: validation.error,
  };
}
