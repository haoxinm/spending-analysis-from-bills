import * as React from "react";

import { useTaxonomy } from "@/api/hooks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/primitives/states";
import { CategoryBadge } from "@/components/primitives/category-badge";
import { Money } from "@/components/primitives/money";

import { buildCategoryChoices, CategoryPicker } from "./components/category-picker";
import { PendingStores } from "./components/pending-stores";
import { usePendingSubcategories } from "./use-pending-subcategories";
import { useReviewQueue } from "./use-review-queue";
import type { Transaction } from "./types";

/**
 * The review screen (§P3-B) — "the highest-value screen": a keyboard-driven queue of
 * `needs_review` transactions, plus a panel for `pending_approval` "stores" (dynamically
 * proposed subcategories) to approve or merge.
 *
 * Keys (ignored while a text input has focus, or with a modifier held, so they never fight
 * the browser or a future search box):
 *   - `j` / `k`     move to the next / previous transaction in the queue
 *   - `1`-`9`       stage that quick-pick category (and its default subcategory) on the
 *                   current transaction — click a chip afterwards to refine the subcategory
 *   - `Enter`       accept the current transaction: the staged pick, or the cascade's own
 *                   proposal if nothing was staged
 *   - `r`           accept, and also promote it into a rule (`TransactionPatch.create_rule`)
 *   - `u`           undo the single most recent accept
 *
 * Two contract gaps block part of what §P3-B asks for, and are the subject of contract change
 * requests against `src/spend_analyzer/api/schemas.py` / `routers/` (outside this WP's
 * `Owns: frontend/src/screens/review/**`, so this screen cannot fix them itself):
 *
 *   1. `Transaction` (§3.12) has no `description_raw` field, only `description_clean`, so this
 *      screen cannot literally show them "alongside" each other as the plan asks. It renders
 *      `description_clean` and, defensively, an optional `description_raw` if a future backend
 *      response includes one (see `RawDescription` below) — today it shows a note instead.
 *   2. `GET /transactions` has no `needs_review` filter, so the queue is built by paging through
 *      every transaction and filtering client-side (`api.ts`'s `fetchNeedsReviewQueue`), and
 *      `Subcategory` (§3.12) has no numeric `id`, so the pending-stores approve/merge actions
 *      have no id to call `/taxonomy/subcategories/{id}/...` with (see
 *      `use-pending-subcategories.ts`) and stay disabled until the backend adds one.
 */
export default function ReviewScreen() {
  const queue = useReviewQueue();
  const taxonomy = useTaxonomy();
  const pendingSubcategories = usePendingSubcategories();

  const categories = React.useMemo(() => taxonomy.data ?? [], [taxonomy.data]);
  const choices = React.useMemo(() => buildCategoryChoices(categories), [categories]);

  React.useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "j") {
        event.preventDefault();
        queue.next();
        return;
      }
      if (event.key === "k") {
        event.preventDefault();
        queue.previous();
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        void queue.accept();
        return;
      }
      if (event.key === "r") {
        event.preventDefault();
        void queue.accept({ createRule: true });
        return;
      }
      if (event.key === "u") {
        event.preventDefault();
        void queue.undo();
        return;
      }
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= 9) {
        const choice = choices[digit - 1];
        if (choice) {
          event.preventDefault();
          queue.stage(choice.categoryKey, choice.subcategoryKey);
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [queue, choices]);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Review</h1>
          <p className="text-sm text-muted-foreground">
            {queue.status === "ready" ? `${queue.queue.length} need review` : "Loading…"}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!queue.canUndo || queue.isMutating} onClick={() => void queue.undo()}>
          Undo (u)
        </Button>
      </header>

      <section aria-label="Transaction queue">
        {queue.status === "loading" ? <LoadingState rows={4} /> : null}
        {queue.status === "error" ? (
          <ErrorState
            title="Could not load the review queue"
            description={queue.error instanceof Error ? queue.error.message : undefined}
            onRetry={queue.refetch}
          />
        ) : null}
        {queue.status === "ready" && queue.queue.length === 0 ? (
          <EmptyState title="Nothing needs review" description="Every transaction has a confident category." />
        ) : null}
        {queue.status === "ready" && queue.current ? (
          <TransactionCard
            transaction={queue.current}
            position={queue.index}
            total={queue.queue.length}
            categories={categories}
            stagedCategoryKey={queue.stagedForCurrent?.categoryKey}
            stagedSubcategoryKey={queue.stagedForCurrent?.subcategoryKey}
            onStage={queue.stage}
            onAccept={() => void queue.accept()}
            onAcceptAndCreateRule={() => void queue.accept({ createRule: true })}
            disabled={queue.isMutating}
          />
        ) : null}
      </section>

      <section aria-label="Pending stores" className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">Pending stores</h2>
        <PendingStores {...pendingSubcategories} />
      </section>
    </div>
  );
}

export const screenMeta = { path: "/review", title: "Review" };

interface TransactionCardProps {
  transaction: Transaction;
  position: number;
  total: number;
  categories: Parameters<typeof CategoryPicker>[0]["categories"];
  stagedCategoryKey?: string;
  stagedSubcategoryKey?: string;
  onStage: (categoryKey: string, subcategoryKey: string) => void;
  onAccept: () => void;
  onAcceptAndCreateRule: () => void;
  disabled: boolean;
}

function TransactionCard({
  transaction,
  position,
  total,
  categories,
  stagedCategoryKey,
  stagedSubcategoryKey,
  onStage,
  onAccept,
  onAcceptAndCreateRule,
  disabled,
}: TransactionCardProps) {
  const effectiveCategoryKey = stagedCategoryKey ?? transaction.category_key ?? undefined;
  const effectiveSubcategoryKey = stagedSubcategoryKey ?? transaction.subcategory_key ?? undefined;

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="text-base font-semibold">{transaction.description_clean}</CardTitle>
          <RawDescription transaction={transaction} />
          <p className="mt-1 text-xs text-muted-foreground">
            {transaction.posted_date} · #{position + 1} of {total}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Money minorUnits={transaction.amount_minor} currency={transaction.currency} className="text-lg font-semibold" />
          {effectiveCategoryKey ? (
            <CategoryBadge categoryKey={effectiveCategoryKey} needsReview={transaction.needs_review} />
          ) : (
            <Badge variant="secondary">Uncategorized</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CategoryPicker
          categories={categories}
          stagedCategoryKey={effectiveCategoryKey}
          stagedSubcategoryKey={effectiveSubcategoryKey}
          onPick={onStage}
          disabled={disabled}
        />
        <div className="flex gap-2">
          <Button type="button" onClick={onAccept} disabled={disabled}>
            Accept (Enter)
          </Button>
          <Button type="button" variant="secondary" onClick={onAcceptAndCreateRule} disabled={disabled}>
            Accept + create rule (r)
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Renders `description_raw` next to `description_clean`, as the plan asks (§P3-B) — when
 * the API response has one. `Transaction` (§3.12) does not define this field today (contract
 * gap #1, see this module's doc comment), so most responses will not have it; this reads it
 * defensively rather than asserting the type, so the day the backend adds it, it appears with no
 * frontend change.
 */
function RawDescription({ transaction }: { transaction: Transaction }) {
  const withOptionalRaw = transaction as Transaction & { description_raw?: string };
  if (typeof withOptionalRaw.description_raw !== "string") {
    return (
      <p className="text-xs text-muted-foreground italic">
        Raw description unavailable (backend does not expose it yet)
      </p>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      Raw: <span className="font-mono">{withOptionalRaw.description_raw}</span>
    </p>
  );
}
