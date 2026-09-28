import { Money } from "@/components/primitives/money";
import { EmptyState } from "@/components/primitives/states";

import type { User } from "../logic";
import type { UserTotal } from "../logic";

export interface UserComparisonProps {
  totals: readonly UserTotal[];
  users: readonly User[];
  currency: string;
}

function nameFor(users: readonly User[], userId: number): string {
  return users.find((u) => u.id === userId)?.name ?? `User ${userId}`;
}

/** Only rendered by the screen when more than one user exists (P3-D's brief); this component
 * itself stays agnostic so it is trivially testable with any `totals` length. */
export function UserComparison({ totals, users, currency }: UserComparisonProps) {
  if (totals.length === 0) {
    return (
      <EmptyState title="No spending yet" description="Per-user totals will appear here once classified." />
    );
  }

  const maxMinor = Math.max(...totals.map((t) => Math.abs(t.totalMinor)), 1);

  return (
    <ul className="flex flex-col gap-2" data-testid="user-comparison">
      {totals.map((total) => (
        <li key={total.userId} className="flex items-center gap-3">
          <div className="w-24 flex-shrink-0 truncate text-sm font-medium">
            {nameFor(users, total.userId)}
          </div>
          <div className="relative h-5 flex-1 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded bg-primary"
              style={{ width: `${(Math.abs(total.totalMinor) / maxMinor) * 100}%` }}
            />
          </div>
          <Money minorUnits={total.totalMinor} currency={currency} className="w-20 flex-shrink-0 text-right text-sm" />
        </li>
      ))}
    </ul>
  );
}
