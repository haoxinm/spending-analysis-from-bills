/**
 * Client-side mirror of the egress preview: the literal CSV `classify_batch` would send, and
 * the redaction counters the trust panel shows alongside it (P3-E section, "Preview what will
 * be sent").
 *
 * This is display-only and enforces nothing: `assert_safe` (`classify/llm/egress.py`, §3.7) is
 * the real, server-side guard that raises on a violation. In correct operation every counter
 * here is always 0, because normalization already strips everything `FORBIDDEN` matches (A13);
 * a non-zero counter would mean a normalization bug, which is exactly what this panel exists to
 * surface before the first network request of a run, not after.
 */

/** Mirrors `classify/llm/egress.py`'s `FORBIDDEN` (§3.7), for display only — see module doc. */
const FORBIDDEN_PATTERNS: ReadonlyArray<{ key: string; label: string; pattern: RegExp }> = [
  { key: "longDigitRuns", label: "Long digit runs (cards, account numbers)", pattern: /\d{6,}/g },
  { key: "emails", label: "Email addresses", pattern: /[\w.+-]+@[\w-]+\.\w+/g },
  { key: "phones", label: "Phone numbers", pattern: /\+?\d[\d\-() ]{8,}\d/g },
  { key: "currencyAmounts", label: "Currency amounts", pattern: /\$\s?\d/g },
  { key: "isoDates", label: "ISO dates", pattern: /\b\d{4}-\d{2}-\d{2}\b/g },
];

export interface RedactionSignalCount {
  key: string;
  label: string;
  count: number;
}

export interface RedactionSummary {
  totalRows: number;
  signals: RedactionSignalCount[];
  /** Sum of every signal's count; 0 in correct operation (see module doc). */
  totalFlagged: number;
}

/** Counts, per `FORBIDDEN` pattern, how many of the given texts would match. */
export function summarizeRedactionSignals(descriptions: readonly string[]): RedactionSummary {
  const signals = FORBIDDEN_PATTERNS.map(({ key, label, pattern }) => ({
    key,
    label,
    count: descriptions.reduce((count, text) => count + (text.match(pattern)?.length ?? 0), 0),
  }));
  return {
    totalRows: descriptions.length,
    signals,
    totalFlagged: signals.reduce((sum, s) => sum + s.count, 0),
  };
}

/** RFC-4180-ish field quoting: quote a field containing a comma, quote or newline. */
function quoteCsvField(field: string): string {
  if (/[",\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/**
 * Builds the exact two-column `id,description` CSV `build_csv` sends (§3.7). `id` is `1..N`
 * **per request**, never a database id (so nothing correlates across requests) — the same rule
 * this preview follows.
 */
export function buildPreviewCsv(descriptions: readonly string[]): string {
  const lines = ["id,description"];
  descriptions.forEach((description, index) => {
    lines.push(`${index + 1},${quoteCsvField(description)}`);
  });
  return lines.join("\n");
}
