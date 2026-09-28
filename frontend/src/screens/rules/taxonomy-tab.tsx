import * as React from "react";

import type { components } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/use-toast";
import { EmptyState, ErrorState, LoadingState } from "@/components/primitives/states";

import { useApproveSubcategory, useMergeSubcategory, useTaxonomy } from "./hooks";

type Category = components["schemas"]["Category"];
type Subcategory = components["schemas"]["Subcategory"];

/** A pending subcategory row, with approve/merge (`/taxonomy/subcategories/{id}/...`, §3.12)
 * wired against `Subcategory.id`. */
function SubcategoryRow({
  categoryKey,
  subcategory,
  mergeTargets,
}: {
  categoryKey: string;
  subcategory: Subcategory;
  mergeTargets: Array<{ id: number; key: string; name: string }>;
}) {
  const [mergeTarget, setMergeTarget] = React.useState("");
  const approveSubcategory = useApproveSubcategory();
  const mergeSubcategory = useMergeSubcategory();
  const { toast } = useToast();

  function approve() {
    approveSubcategory.mutate(subcategory.id, {
      onSuccess: () => toast({ title: `Approved "${subcategory.name}"`, variant: "success" }),
      onError: (err) =>
        toast({
          title: `Could not approve "${subcategory.name}"`,
          description: err instanceof Error ? err.message : String(err),
          variant: "destructive",
        }),
    });
  }

  function merge() {
    const into = mergeTargets.find((t) => t.key === mergeTarget);
    if (!into) return;
    mergeSubcategory.mutate(
      { subcategoryId: subcategory.id, body: { into_id: into.id } },
      {
        onSuccess: () => {
          toast({ title: `Merged "${subcategory.name}" into "${into.name}"`, variant: "success" });
          setMergeTarget("");
        },
        onError: (err) =>
          toast({
            title: `Could not merge "${subcategory.name}"`,
            description: err instanceof Error ? err.message : String(err),
            variant: "destructive",
          }),
      },
    );
  }

  const busy = approveSubcategory.isPending || mergeSubcategory.isPending;

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
          <Button size="sm" variant="outline" onClick={approve} disabled={busy}>
            Approve
          </Button>
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-xs shadow-sm"
            aria-label={`Merge ${subcategory.name} into`}
            value={mergeTarget}
            onChange={(e) => setMergeTarget(e.target.value)}
            disabled={busy}
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
          <Button size="sm" variant="outline" onClick={merge} disabled={busy || mergeTarget === ""}>
            Merge
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CategoryCard({ category }: { category: Category }) {
  const mergeTargets = category.subcategories.map((s) => ({ id: s.id, key: s.key, name: s.name }));
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
