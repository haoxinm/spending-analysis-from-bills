import * as React from "react";

import { Money } from "@/components/primitives/money";
import { Badge } from "@/components/ui/badge";

import { formTypeLabel, groupPayers, type TaxIncomePayer } from "../logic";

export function IncomeByPayer({ rows, year }: { rows: readonly TaxIncomePayer[]; year: number }) {
  const payers = React.useMemo(() => groupPayers(rows, year), [rows, year]);
  if (payers.length === 0) {
    return <p className="text-sm text-muted-foreground">No W-2 or 1099 income for {year}.</p>;
  }
  return (
    <table className="w-full text-sm" data-testid="income-by-payer">
      <caption className="sr-only">Income by payer</caption>
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th scope="col" className="pb-1 font-medium">Payer</th>
          <th scope="col" className="pb-1 font-medium">Form</th>
          <th scope="col" className="pb-1 text-right font-medium">Amount</th>
        </tr>
      </thead>
      <tbody>
        {payers.map((p) => (
          <tr key={p.key} className="border-t border-border align-top">
            <td className="py-1.5">
              {p.payerName}
              {p.lines.length > 1 ? (
                <span className="block text-xs text-muted-foreground">
                  {p.lines.map((l) => l.label).join(", ")}
                </span>
              ) : null}
            </td>
            <td className="py-1.5">
              <Badge variant="secondary">{formTypeLabel(p.formType)}</Badge>
            </td>
            <td className="py-1.5 text-right">
              <Money tone="neutral" minorUnits={p.totalMinor} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
