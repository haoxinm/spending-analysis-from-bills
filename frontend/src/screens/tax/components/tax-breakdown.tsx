import { Money } from "@/components/primitives/money";
import { Badge } from "@/components/ui/badge";

import { taxBreakdownRows, type TaxSummary } from "../logic";

export function TaxBreakdown({ summary }: { summary: TaxSummary }) {
  const groups = taxBreakdownRows(summary);
  return (
    <table className="w-full text-sm" data-testid="tax-breakdown">
      <caption className="sr-only">Tax breakdown</caption>
      <tbody>
        {groups.map((g) => (
          <GroupRows key={g.key} group={g} />
        ))}
      </tbody>
    </table>
  );
}

function GroupRows({ group }: { group: ReturnType<typeof taxBreakdownRows>[number] }) {
  return (
    <>
      <tr>
        <th
          scope="colgroup"
          colSpan={2}
          className="pb-1 pt-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {group.title}
        </th>
      </tr>
      {group.rows.length === 0 ? (
        <tr className="border-t border-border">
          <td colSpan={2} className="py-1.5 text-muted-foreground">
            Not reported (no return imported)
          </td>
        </tr>
      ) : (
        group.rows.map((r) => (
          <tr key={r.key} className="border-t border-border">
            <td className="py-1.5">
              {r.label}
              {r.estimate ? (
                <Badge
                  variant="outline"
                  className="ml-2"
                  title="Estimated with the IRS tax worksheets; may differ from the filed return."
                >
                  estimate
                </Badge>
              ) : null}
            </td>
            <td className="py-1.5 text-right">
              {r.amountMinor === null ? (
                <span className="text-muted-foreground">{r.missingText ?? "—"}</span>
              ) : (
                <Money tone="neutral" minorUnits={r.amountMinor} />
              )}
            </td>
          </tr>
        ))
      )}
    </>
  );
}
