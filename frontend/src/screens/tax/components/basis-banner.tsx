import { basisNotice, incomeBasisLabel, type TaxSummary } from "../logic";

/** Notices above the numbers: income-basis fallback/mixed, plus the backend's reconciliation
 * warnings (wage mismatch, estimate caveat, corrected forms). */
export function BasisBanner({ summary }: { summary: TaxSummary }) {
  const notice = basisNotice(summary.income_basis);
  if (!notice && summary.warnings.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="basis-banner"
      className="flex flex-col gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
    >
      {notice ? (
        <p>
          <span className="font-medium">Income basis: {incomeBasisLabel(summary.income_basis)}.</span> {notice}
        </p>
      ) : null}
      {summary.warnings.length > 0 ? (
        <ul className="list-disc pl-5 text-muted-foreground">
          {summary.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
