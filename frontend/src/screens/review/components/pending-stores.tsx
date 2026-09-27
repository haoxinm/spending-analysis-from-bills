import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, LoadingState } from "@/components/primitives/states";

import type { MergeTarget, UsePendingSubcategoriesResult } from "../use-pending-subcategories";

/**
 * "Pending stores": dynamically-proposed subcategories awaiting approval, each rendered with the
 * "approve / merge into ▾" picker the plan calls for (§P3-B, e.g. "Yami — approve /
 * merge into ▾"). Approve and merge are disabled, with an inline explanation, for any row
 * without a numeric id — see the contract-gap doc on `usePendingSubcategories`.
 */
export function PendingStores({ pending, mergeTargets, approve, merge, isBusy, isLoading, isError }: UsePendingSubcategoriesResult) {
  const [openMergeFor, setOpenMergeFor] = React.useState<string | null>(null);

  if (isLoading) return <LoadingState rows={2} />;
  if (isError) {
    return (
      <p className="text-sm text-destructive">Could not load pending stores.</p>
    );
  }
  if (pending.length === 0) {
    return <EmptyState title="No stores waiting on approval" />;
  }

  return (
    <ul className="flex flex-col gap-2">
      {pending.map((row) => {
        const hasId = typeof row.id === "number";
        const busy = isBusy(row.key);
        return (
          <li key={row.key}>
            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2 py-3">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  {row.name}
                  <Badge variant="secondary" className="text-[10px]">
                    {row.categoryLabel}
                  </Badge>
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!hasId || busy}
                    onClick={() => approve(row)}
                  >
                    Approve
                  </Button>
                  <div className="relative">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={!hasId || busy || mergeTargets.length === 0}
                      onClick={() => setOpenMergeFor((k) => (k === row.key ? null : row.key))}
                    >
                      Merge into ▾
                    </Button>
                    {openMergeFor === row.key ? (
                      <MergeMenu
                        targets={mergeTargets}
                        onChoose={(target) => {
                          setOpenMergeFor(null);
                          merge(row, target);
                        }}
                        onClose={() => setOpenMergeFor(null)}
                      />
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              {!hasId ? (
                <CardContent className="pt-0 text-xs text-muted-foreground">
                  Waiting on a backend change (the API does not yet expose this store&rsquo;s id) —
                  see the contract change request in <code>use-pending-subcategories.ts</code>.
                </CardContent>
              ) : null}
            </Card>
          </li>
        );
      })}
    </ul>
  );
}

function MergeMenu({
  targets,
  onChoose,
  onClose,
}: {
  targets: MergeTarget[];
  onChoose: (target: MergeTarget) => void;
  onClose: () => void;
}) {
  return (
    <div
      role="menu"
      className="absolute right-0 z-10 mt-1 max-h-56 w-56 overflow-auto rounded-md border border-border bg-card p-1 shadow-lg"
    >
      <button
        type="button"
        className="mb-1 w-full rounded-sm px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted"
        onClick={onClose}
      >
        Cancel
      </button>
      {targets.map((target) => (
        <button
          key={target.key}
          type="button"
          role="menuitem"
          className="w-full rounded-sm px-2 py-1 text-left text-sm hover:bg-muted"
          onClick={() => onChoose(target)}
        >
          {target.label}
          <span className="ml-1 text-xs text-muted-foreground">({target.categoryLabel})</span>
        </button>
      ))}
    </div>
  );
}
