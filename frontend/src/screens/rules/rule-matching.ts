/**
 * Client-side mirror of `classify/rules.py::rule_matches_text` (backend, frozen). Kept in sync
 * by hand since the frontend owns no Python: `exact` compares the whole casefolded, stripped
 * string; `contains` is a casefolded substring test; `regex` is `re.search` with
 * `re.IGNORECASE`, approximated here with JS's case-insensitive `i` flag (both use Unicode
 * case folding for the ASCII ranges every fixture and rule in this app uses).
 *
 * Used only for the Rules tab's live "this would match N existing transactions" preview
 * (§2f / P3-F) — never sent to the server, never egressed, and never a substitute for the
 * backend's own evaluation at classification time.
 */

export type RuleMatchType = "exact" | "contains" | "regex";

/** Longer than any real merchant-name pattern needs; guards against pathological regexes. */
export const MAX_PATTERN_LENGTH = 200;

export interface PatternValidation {
  valid: boolean;
  error?: string;
}

/**
 * Validates a pattern for `matchType` without evaluating it against any data. `regex` patterns
 * are compiled with `new RegExp` to catch a syntax error before the pattern is ever sent to the
 * API (P3-F acceptance: "a regex rule must be validated client-side before it is sent").
 */
export function validatePattern(pattern: string, matchType: RuleMatchType): PatternValidation {
  if (pattern.trim().length === 0) {
    return { valid: false, error: "Pattern cannot be empty." };
  }
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return { valid: false, error: `Pattern must be ${MAX_PATTERN_LENGTH} characters or fewer.` };
  }
  if (matchType === "regex") {
    try {
      RegExp(pattern, "i");
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : "Invalid regex." };
    }
  }
  return { valid: true };
}

/** Mirrors `rule_matches_text`. Returns `false` (never throws) for an invalid regex. */
export function ruleMatchesText(
  matchType: RuleMatchType,
  pattern: string,
  merchantKey: string,
): boolean {
  if (matchType === "exact") {
    return merchantKey.trim().toLowerCase() === pattern.trim().toLowerCase();
  }
  if (matchType === "contains") {
    return merchantKey.toLowerCase().includes(pattern.toLowerCase());
  }
  try {
    return new RegExp(pattern, "i").test(merchantKey);
  } catch {
    return false;
  }
}
