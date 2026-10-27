import { Money } from "@/components/primitives/money";
import { Card, CardContent } from "@/components/ui/card";

import {
  formatRate,
  headlineTax,
  refundOrOwed,
  type TaxSummary,
} from "../logic";

function StatCard({
  label,
  hint,
  title,
  children,
  testId,
}: {
  label: string;
  hint?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId} title={title}>
      <CardContent className="flex flex-col gap-1 p-4">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <span className="text-2xl font-semibold tabular-nums">{children}</span>
        {hint ? (
          <span className="text-xs text-muted-foreground">{hint}</span>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function SummaryCards({ summary }: { summary: TaxSummary }) {
  const tax = headlineTax(summary);
  const result = refundOrOwed(summary);
  const resultLabel =
    result.kind === "owed"
      ? "Amount owed"
      : result.kind === "refund"
        ? "Refund"
        : "Refund / owed";
  return (
    <div
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
      data-testid="tax-summary-cards"
    >
      <StatCard
        label="Total income"
        hint={`${summary.document_count} document${summary.document_count === 1 ? "" : "s"}`}
      >
        <Money tone="neutral" minorUnits={summary.total_income_minor} />
      </StatCard>
      <StatCard
        label="Total tax"
        hint={
          <>
            Federal <Money tone="neutral" minorUnits={tax.federalMinor} /> (
            {tax.federalKind === "liability" ? "liability" : "withheld"}) · FICA{" "}
            <Money tone="neutral" minorUnits={tax.ficaMinor} /> · State{" "}
            <Money tone="neutral" minorUnits={tax.stateMinor} />
          </>
        }
      >
        <Money tone="neutral" minorUnits={tax.totalMinor} />
      </StatCard>
      <StatCard
        label="Effective federal rate"
        title="Federal income tax divided by total income. Uses total federal tax from the return, or federal withholding when there is no return."
        hint="Federal tax ÷ total income"
        testId="effective-rate-card"
      >
        {formatRate(summary.federal_effective_rate)}
      </StatCard>
      <StatCard
        label="All-in rate"
        title="Federal, FICA and state tax combined, divided by total income."
        hint="Federal + FICA + state ÷ income"
        testId="all-in-rate-card"
      >
        {formatRate(summary.all_in_rate)}
      </StatCard>
      <StatCard
        label={resultLabel}
        hint={
          result.kind === "unknown"
            ? "Import your 1040 to see this"
            : result.derived
              ? "Estimated: payments minus tax"
              : result.kind === "even"
                ? "Nothing due or returned"
                : "From your return"
        }
      >
        {result.amountMinor === null ? (
          "—"
        ) : (
          <Money tone="neutral" minorUnits={result.amountMinor} />
        )}
      </StatCard>
    </div>
  );
}
