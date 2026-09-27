import type { ColumnDef } from "@tanstack/react-table";

import { CategoryBadge } from "@/components/primitives/category-badge";
import { Money } from "@/components/primitives/money";

import type { Category, Transaction } from "./types";

export interface ColumnsContext {
  categories: Category[];
  selectedIds: Set<number>;
  onToggleRow: (id: number) => void;
  onEdit: (transaction: Transaction) => void;
}

function categoryLabel(categories: Category[], key: string | null): string | undefined {
  if (key === null) return undefined;
  return categories.find((c) => c.key === key)?.name;
}

function subcategoryLabel(
  categories: Category[],
  categoryKey: string | null,
  subcategoryKey: string | null,
): string | undefined {
  if (categoryKey === null || subcategoryKey === null) return undefined;
  const category = categories.find((c) => c.key === categoryKey);
  return category?.subcategories.find((s) => s.key === subcategoryKey)?.name;
}

/**
 * Builds the transactions grid's column defs. A factory, not a module-level constant, because
 * cell renderers close over `context` (selection state, the edit callback, the taxonomy) — but
 * every call site memoizes the result with `React.useMemo(() => createColumns(context), [...])`
 * keyed on `context`'s own pieces, so a column def is never rebuilt on an unrelated re-render
 * (§P3_BRIEF: "never re-create column defs per render").
 */
export function createColumns(context: ColumnsContext): ColumnDef<Transaction>[] {
  return [
    {
      id: "select",
      header: () => null,
      size: 36,
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`Select transaction ${row.original.id}`}
          checked={context.selectedIds.has(row.original.id)}
          onChange={() => context.onToggleRow(row.original.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      id: "date",
      header: "Date",
      accessorFn: (row) => row.posted_date,
      size: 100,
    },
    {
      id: "description",
      header: "Description",
      accessorFn: (row) => row.description_clean,
      cell: ({ row }) => (
        <span className="truncate" title={row.original.description_clean}>
          {row.original.description_clean}
        </span>
      ),
    },
    {
      id: "category",
      header: "Category",
      cell: ({ row }) => {
        const txn = row.original;
        if (txn.category_key === null) {
          return (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                context.onEdit(txn);
              }}
            >
              Uncategorized
            </button>
          );
        }
        return (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              context.onEdit(txn);
            }}
          >
            <CategoryBadge
              categoryKey={txn.category_key}
              label={categoryLabel(context.categories, txn.category_key)}
              subcategoryLabel={subcategoryLabel(
                context.categories,
                txn.category_key,
                txn.subcategory_key,
              )}
              needsReview={txn.needs_review}
            />
          </button>
        );
      },
      size: 220,
    },
    {
      id: "kind",
      header: "Kind",
      accessorFn: (row) => row.kind,
      size: 90,
    },
    {
      id: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <Money minorUnits={row.original.amount_minor} currency={row.original.currency} />
      ),
      size: 110,
    },
    {
      id: "notes",
      header: "Notes",
      cell: ({ row }) => <span className="truncate text-muted-foreground">{row.original.notes}</span>,
    },
  ];
}
