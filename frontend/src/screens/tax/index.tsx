import * as React from "react";

import { EmptyState, ErrorState, LoadingState } from "@/components/primitives/states";
import { UserSwitcher } from "@/components/primitives/user-switcher";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSelectedUser } from "@/hooks/use-selected-user";

import { BasisBanner } from "./components/basis-banner";
import { DocumentsPanel } from "./components/documents-panel";
import { IncomeBreakdown } from "./components/income-breakdown";
import { IncomeByPayer } from "./components/income-by-payer";
import { SummaryCards } from "./components/summary-cards";
import { TaxBreakdown } from "./components/tax-breakdown";
import { YearOverYear } from "./components/year-over-year";
import { YearPicker } from "./components/year-picker";
import { useTaxDocuments, useTaxIncomeByPayer, useTaxSummary, useTaxYears } from "./hooks";
import { resolveYear } from "./logic";

export const screenMeta = { path: "/tax", title: "Income & Tax" };

const EMPTY_TEXT = "Import a W-2, 1099 or 1040 to see income and tax";

/**
 * Income & Tax: per-year income by category and payer, withholding / FICA / liability, effective
 * rates and imported documents. Amounts are neutral (income and tax are not "spending").
 */
export default function TaxScreen() {
  const sel = useSelectedUser();
  const ready = !sel.isLoading;
  const yearsQuery = useTaxYears(sel.userIds, ready);
  const summaryQuery = useTaxSummary(sel.userIds, ready);
  const payersQuery = useTaxIncomeByPayer(sel.userIds, ready);
  const documentsQuery = useTaxDocuments(sel.selectedUserId, ready);

  const [pickedYear, setPickedYear] = React.useState<number | null>(null);
  const years = yearsQuery.data ?? [];
  const year = resolveYear(pickedYear, years);
  const summaries = summaryQuery.data ?? [];
  const summary = summaries.find((s) => s.tax_year === year) ?? null;

  const error = yearsQuery.error ?? summaryQuery.error;
  const loading = sel.isLoading || yearsQuery.isLoading || summaryQuery.isLoading;
  const documents = documentsQuery.data ?? [];
  const hasData = years.length > 0 && summaries.length > 0;

  const documentsCard = (
    <Card>
      <CardHeader>
        <CardTitle>Documents</CardTitle>
      </CardHeader>
      <CardContent>
        {documentsQuery.error ? (
          <ErrorState description={documentsQuery.error.message} />
        ) : (
          <DocumentsPanel documents={documents} users={sel.users} selectedUserId={sel.selectedUserId} />
        )}
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{screenMeta.title}</h1>
          <p className="text-sm text-muted-foreground">
            Income, withholding and tax from your W-2, 1099 and 1040 forms.
            {sel.users.length > 1 && sel.selectedUser ? ` Showing ${sel.selectedUser.name}.` : ""}
          </p>
        </div>
        <UserSwitcher users={sel.users} value={sel.selectedUserId} onChange={sel.setSelectedUserId} />
      </div>

      {error ? (
        <ErrorState description={error instanceof Error ? error.message : String(error)} />
      ) : loading ? (
        <LoadingState rows={4} />
      ) : !hasData ? (
        <EmptyState title={EMPTY_TEXT} description="Upload tax form PDFs below to get started." />
      ) : (
        <>
          <YearPicker years={years} value={year} onChange={setPickedYear} />
          {summary ? (
            <>
              <BasisBanner summary={summary} />
              <SummaryCards summary={summary} />
              <div className="grid items-start gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>Income by category</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <IncomeBreakdown summary={summary} />
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Tax breakdown</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <TaxBreakdown summary={summary} />
                  </CardContent>
                </Card>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Income by payer</CardTitle>
                </CardHeader>
                <CardContent>
                  {payersQuery.error ? (
                    <ErrorState description={payersQuery.error.message} />
                  ) : (
                    <IncomeByPayer rows={payersQuery.data ?? []} year={summary.tax_year} />
                  )}
                </CardContent>
              </Card>
            </>
          ) : null}
          {summaries.length > 1 ? (
            <Card>
              <CardHeader>
                <CardTitle>Year over year</CardTitle>
              </CardHeader>
              <CardContent>
                <YearOverYear summaries={summaries} />
              </CardContent>
            </Card>
          ) : null}
        </>
      )}

      {documentsCard}
    </div>
  );
}
