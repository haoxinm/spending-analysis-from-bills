import * as React from "react";

import type { components } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/primitives/states";

import { useTaxonomy } from "./hooks";

type Category = components["schemas"]["Category"];
type Subcategory = components["schemas"]["Subcategory"];

/**
 * A pending subcategory row. Approve/merge are wired up to `useApproveSubcategory` /
 * `useMergeSubcategory` (`hooks.ts`) exactly against the frozen `/taxonomy/subcategories/{id}`
 * contract, but that `{id}` is a numeric database id the `GET /taxonomy` response never
 * includes — `Subcategory` (§3.12) carries only `key`, `name`, `pending`, `merged_into`. There
 * is no client-side way to recover the id from the key, so the actions below are disabled with
 * an explanation rather than silently sent against a guessed id. See this WP's final report for
 * the corresponding contract change request (add `id: int` to `schemas.Subcategory`).
 */
function SubcategoryRow({
  categoryKey,
  subcategory,
  mergeTargets,
}: {
  categoryKey: string;
  subcategory: Subcategory;
  mergeTargets: Array<{ key: string; name: string }>;
}) {
  const [mergeTarget, setMergeTarget] = React.useState("");
  const blockedReason = "Needs the subcategory's numeric id, not returned by GET /taxonomy yet.";

  return (
    <div className="flex flex-col gap-2 border-b border-border py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm">{subcategory.name}</span>
        <span className="text-xs text-muted-foreground">({subcategory.key})</span>
        {subcategory.pending ? <Badge variant="secondary">pending approval</Badge> : null}
        {subcategory.merged_into ? (
          <Badge variant="outline">merged into {subcategory.merged_into}</Badge>
        ) : null}
      </div>
      {subcategory.pending && !subcategory.merged_into ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled title={blockedReason}>
            Approve
          </Button>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm"
            aria-label={`Merge ${subcategory.name} into`}
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            disabled
          >
            <option value="">Merge into…</option>
            {mergeTargets
              .filter((t) => t.key !== subcategory.key)
              .map((t) => (
                <option key={t.key} value={t.key}>
                  {categoryKey} / {t.name}
                </option>
              ))}
          </select>
          <Button size="sm" variant="outline" disabled title={blockedReason}>
            Merge
          </Button>
          <span className="text-xs text-muted-foreground">{blockedReason}</span>
        </div>
      ) : null}
    </div>
  );
}

function CategoryCard({ category }: { category: Category }) {
  const mergeTargets = category.subcategories.map((s) => ({ key: s.key, name: s.name }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {category.name} <span className="text-xs font-normal text-muted-foreground">({category.key})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {category.subcategories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No subcategories.</p>
        ) : (
          category.subcategories.map((sub) => (
            <SubcategoryRow
              key={sub.key}
              categoryKey={category.key}
              subcategory={sub}
              mergeTargets={mergeTargets}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

export function TaxonomyTab() {
  const taxonomyQuery = useTaxonomy();
  const pendingCount = (taxonomyQuery.data ?? []).reduce(
    (sum, cat) => sum + cat.subcategories.filter((s) => s.pending && !s.merged_into).length,
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      {pendingCount > 0 ? (
        <p className="text-sm text-muted-foreground">
          {pendingCount} subcategor{pendingCount === 1 ? "y" : "ies"} awaiting approval or merge.
        </p>
      ) : null}
      {taxonomyQuery.isLoading ? <LoadingState rows={4} /> : null}
      {taxonomyQuery.isError ? (
        <ErrorState
          description={taxonomyQuery.error instanceof Error ? taxonomyQuery.error.message : undefined}
          onRetry={() => void taxonomyQuery.refetch()}
        />
      ) : null}
      {taxonomyQuery.data && taxonomyQuery.data.length === 0 ? (
        <EmptyState title="No taxonomy loaded" description="Taxonomy should be seeded on startup (§3.3)." />
      ) : null}
      {(taxonomyQuery.data ?? []).map((category) => (
        <CategoryCard key={category.key} category={category} />
      ))}
    </div>
  );
}
