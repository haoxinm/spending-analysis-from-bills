import * as React from "react";
import { useSearchParams } from "react-router-dom";

/**
 * The subset of `analytics/query.py::SpendQuery` (§3.9) representable in URL search params.
 * Every field is optional; an absent param means "use the contract's own default", which this
 * hook never invents client-side (e.g. it does not default `granularity` to `"month"` — the
 * request layer / backend owns that default).
 */
export interface SpendQueryParams {
  userIds?: number[];
  accountIds?: number[];
  dateFrom?: string;
  dateTo?: string;
  granularity?: "day" | "week" | "month" | "quarter" | "year" | "all";
  groupBy?: Array<"category" | "subcategory" | "user" | "account" | "merchant" | "period">;
  categoryKeys?: string[];
  subcategoryKeys?: string[];
  amountMinMinor?: number;
  amountMaxMinor?: number;
  kinds?: string[];
  includeNonSpend?: boolean;
  netRefunds?: boolean;
  search?: string;
  currency?: string;
}

const KEY_MAP: Record<keyof SpendQueryParams, string> = {
  userIds: "user_ids",
  accountIds: "account_ids",
  dateFrom: "date_from",
  dateTo: "date_to",
  granularity: "granularity",
  groupBy: "group_by",
  categoryKeys: "category_keys",
  subcategoryKeys: "subcategory_keys",
  amountMinMinor: "amount_min_minor",
  amountMaxMinor: "amount_max_minor",
  kinds: "kinds",
  includeNonSpend: "include_non_spend",
  netRefunds: "net_refunds",
  search: "search",
  currency: "currency",
};

const LIST_KEYS = new Set<keyof SpendQueryParams>([
  "userIds",
  "accountIds",
  "groupBy",
  "categoryKeys",
  "subcategoryKeys",
  "kinds",
]);
const INT_LIST_KEYS = new Set<keyof SpendQueryParams>(["userIds", "accountIds"]);
const INT_KEYS = new Set<keyof SpendQueryParams>(["amountMinMinor", "amountMaxMinor"]);
const BOOL_KEYS = new Set<keyof SpendQueryParams>(["includeNonSpend", "netRefunds"]);

function parse(searchParams: URLSearchParams): SpendQueryParams {
  const result: Partial<Record<keyof SpendQueryParams, unknown>> = {};
  for (const key of Object.keys(KEY_MAP) as Array<keyof SpendQueryParams>) {
    const urlKey = KEY_MAP[key];
    if (LIST_KEYS.has(key)) {
      const values = searchParams.getAll(urlKey);
      if (values.length === 0) continue;
      result[key] = INT_LIST_KEYS.has(key) ? values.map(Number) : values;
      continue;
    }
    const raw = searchParams.get(urlKey);
    if (raw === null) continue;
    if (BOOL_KEYS.has(key)) {
      result[key] = raw === "true";
    } else if (INT_KEYS.has(key)) {
      result[key] = Number(raw);
    } else {
      result[key] = raw;
    }
  }
  return result as SpendQueryParams;
}

function serialize(params: SpendQueryParams): URLSearchParams {
  const searchParams = new URLSearchParams();
  for (const key of Object.keys(KEY_MAP) as Array<keyof SpendQueryParams>) {
    const urlKey = KEY_MAP[key];
    const value = params[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) searchParams.append(urlKey, String(item));
    } else {
      searchParams.set(urlKey, String(value));
    }
  }
  return searchParams;
}

/**
 * Keeps a `SpendQuery`-shaped object in sync with the URL's search params, so every
 * analytics/transactions view is linkable and bookmarkable (§4: "Query plus URL search
 * params is enough" — no global state library). Setting a field to `undefined` removes it
 * from the URL rather than writing an empty string.
 */
export function useSpendQueryParams(): [
  SpendQueryParams,
  (next: Partial<SpendQueryParams>) => void,
] {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = React.useMemo(() => parse(searchParams), [searchParams]);

  const setParams = React.useCallback(
    (next: Partial<SpendQueryParams>) => {
      setSearchParams(serialize({ ...params, ...next }), { replace: true });
    },
    [params, setSearchParams],
  );

  return [params, setParams];
}
