import type { components } from "@/api/client";

type Statement = components["schemas"]["Statement"];

export interface DriftInfo {
  /** True when any of §2d.1's three signals tripped for `current` relative to `previous`. */
  drifted: boolean;
  reasons: string[];
  txnCountDelta: number | null;
  detectScoreDelta: number | null;
}

function parseShapeWarnings(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Computes the `layout_drift` banner (§2d.1) for `current` against the account's previous
 * statement, `previous` (its most recent earlier statement on the same account — the caller
 * picks it from `GET /statements?user_id=`, sorted by `created_at`, filtered to the same
 * `account_id` and excluding `current`). `previous === null` means there is nothing to diff
 * against yet (first statement for this account); this is not itself drift.
 */
export function computeDrift(current: Statement, previous: Statement | null): DriftInfo {
  const reasons: string[] = [];

  const shapeWarnings = parseShapeWarnings(current.shape_warnings);
  if (shapeWarnings.length > 0) {
    reasons.push(...shapeWarnings.map((w) => `shape assertion: ${w}`));
  }

  if (current.reconciliation_delta_minor != null && current.reconciliation_delta_minor !== 0) {
    reasons.push(
      `reconciliation delta of ${(current.reconciliation_delta_minor / 100).toFixed(2)} against the balance equation`,
    );
  }

  let txnCountDelta: number | null = null;
  let detectScoreDelta: number | null = null;

  if (previous !== null) {
    if (current.txn_count != null && previous.txn_count != null) {
      txnCountDelta = current.txn_count - previous.txn_count;
    }
    if (current.detect_score != null && previous.detect_score != null) {
      detectScoreDelta = current.detect_score - previous.detect_score;
      // §2d.1's own example: a drop from 0.95 to 0.62 on a previously clean issuer.
      if (detectScoreDelta <= -0.2) {
        reasons.push(
          `detect() score dropped from ${previous.detect_score.toFixed(2)} to ${current.detect_score.toFixed(2)}`,
        );
      }
    }
  }

  return { drifted: reasons.length > 0, reasons, txnCountDelta, detectScoreDelta };
}

/** Picks the most recent statement before `current`, on the same account, from `all`. */
export function findPreviousStatement(all: readonly Statement[], current: Statement): Statement | null {
  const currentTime = new Date(current.created_at).getTime();
  const earlierSameAccount = all.filter(
    (s) =>
      s.id !== current.id &&
      s.account_id === current.account_id &&
      s.account_id != null &&
      new Date(s.created_at).getTime() < currentTime,
  );
  if (earlierSameAccount.length === 0) return null;
  return earlierSameAccount.reduce((latest, s) =>
    new Date(s.created_at).getTime() > new Date(latest.created_at).getTime() ? s : latest,
  );
}
