import type { DriftInfo } from "./drift";

/** The `layout_drift` banner (§2d.1) — never silently accepted. */
export function DriftBanner({ drift }: { drift: DriftInfo }) {
  if (!drift.drifted) return null;

  return (
    <div role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
      <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
        This statement parsed differently from previous ones from this account — please spot-check before trusting
        the numbers.
      </p>
      <ul className="mt-1 list-inside list-disc text-xs text-amber-700 dark:text-amber-400">
        {drift.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
        {drift.txnCountDelta != null && drift.txnCountDelta !== 0 ? (
          <li>
            transaction count changed by {drift.txnCountDelta > 0 ? "+" : ""}
            {drift.txnCountDelta} versus the previous statement
          </li>
        ) : null}
      </ul>
    </div>
  );
}
