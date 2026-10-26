import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/utils";

import {
  useCreateIncomeItem,
  useCreateTaxItem,
  useDeleteIncomeItem,
  useDeleteTaxItem,
  useUpdateIncomeItem,
  useUpdateTaxItem,
} from "../hooks";
import {
  INCOME_CATEGORY_OPTIONS,
  TAX_CATEGORY_OPTIONS,
  amountError,
  blankToNull,
  categoryLabel,
  dollarsToMinor,
  errorMessage,
  isSignedIncomeCategory,
  itemOriginLabel,
  minorToDollars,
  type IncomeCategory,
  type IncomeItem,
  type TaxCategory,
  type TaxItem,
} from "../logic";
import { SelectField, TextField } from "./fields";

type Kind = "income" | "tax";
type Item = IncomeItem | TaxItem;

interface Draft {
  category: string;
  box: string;
  label: string;
  amount: string;
  /** Income: memo flag. */
  memo: boolean;
  /** Tax: jurisdiction. */
  jurisdiction: string;
}

function draftOf(item: Item | null, kind: Kind): Draft {
  return {
    category: item?.category ?? (kind === "income" ? "salary_wages" : "federal_income_tax_withheld"),
    box: item?.box ?? "",
    label: item?.label ?? "",
    amount: item ? minorToDollars(item.amount_minor) : "",
    memo: item && "is_memo" in item ? item.is_memo : false,
    jurisdiction: item && "jurisdiction" in item ? (item.jurisdiction ?? "") : "",
  };
}

function itemSignature(item: Item): string {
  return JSON.stringify(item);
}

function ItemRow({
  kind,
  item,
  formId,
  onDone,
}: {
  kind: Kind;
  /** null = the "add" row. */
  item: Item | null;
  formId: number;
  onDone?: () => void;
}) {
  const { toast } = useToast();
  const [draft, setDraft] = React.useState(() => draftOf(item, kind));
  const [touched, setTouched] = React.useState(false);
  const createIncome = useCreateIncomeItem();
  const updateIncome = useUpdateIncomeItem();
  const deleteIncome = useDeleteIncomeItem();
  const createTax = useCreateTaxItem();
  const updateTax = useUpdateTaxItem();
  const deleteTax = useDeleteTaxItem();

  const initial = React.useMemo(() => draftOf(item, kind), [item, kind]);
  const dirty = item === null || JSON.stringify(initial) !== JSON.stringify(draft);
  const signed = kind === "income" && isSignedIncomeCategory(draft.category);
  const err = amountError(draft.amount, signed);
  const busy =
    createIncome.isPending ||
    updateIncome.isPending ||
    deleteIncome.isPending ||
    createTax.isPending ||
    updateTax.isPending ||
    deleteTax.isPending;
  const options = kind === "income" ? INCOME_CATEGORY_OPTIONS : TAX_CATEGORY_OPTIONS;
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
  const groupLabel = item
    ? `${kind === "income" ? "Income" : "Tax"} item: ${categoryLabel(kind, item.category)}${item.box ? ` box ${item.box}` : ""}`
    : `New ${kind} item`;

  async function save() {
    setTouched(true);
    if (err) return;
    const amount_minor = dollarsToMinor(draft.amount, signed);
    if (amount_minor === null) return;
    const box = blankToNull(draft.box);
    const label = blankToNull(draft.label);
    try {
      if (kind === "income") {
        const category = draft.category as IncomeCategory;
        if (item) {
          await updateIncome.mutateAsync({
            id: item.id,
            // Only a flag the user changed is sent: the server derives memo from the category
            // otherwise, so a stale flag cannot pin an item as memo after a category change.
            patch: {
              category,
              amount_minor,
              box,
              label,
              ...(draft.memo !== ("is_memo" in item && item.is_memo) ? { is_memo: draft.memo } : {}),
            },
          });
        } else {
          await createIncome.mutateAsync({
            formId,
            body: { category, amount_minor, box, label, is_memo: draft.memo },
          });
        }
      } else {
        const category = draft.category as TaxCategory;
        const jurisdiction = blankToNull(draft.jurisdiction);
        if (item) {
          await updateTax.mutateAsync({
            id: item.id,
            patch: { category, amount_minor, box, label, jurisdiction },
          });
        } else {
          await createTax.mutateAsync({
            formId,
            body: { category, amount_minor, box, label, jurisdiction, is_estimate: false },
          });
        }
      }
      toast({ variant: "success", title: item ? "Item updated" : "Item added" });
      setTouched(false);
      if (!item) onDone?.();
    } catch (e) {
      toast({ variant: "destructive", title: "Could not save item", description: errorMessage(e) });
    }
  }

  async function remove() {
    if (!item) return;
    try {
      if (kind === "income") await deleteIncome.mutateAsync(item.id);
      else await deleteTax.mutateAsync(item.id);
      toast({ title: "Item deleted" });
    } catch (e) {
      toast({ variant: "destructive", title: "Could not delete item", description: errorMessage(e) });
    }
  }

  const origin = item ? itemOriginLabel(item.origin) : null;
  return (
    <form
      role="group"
      aria-label={groupLabel}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className={cn(
        "flex flex-wrap items-start gap-2 rounded-md border border-border p-2",
        item?.origin === "llm" && "border-amber-500/60 bg-amber-500/10",
      )}
    >
      <SelectField
        label="Category"
        value={draft.category}
        options={options}
        onChange={(v) =>
          set({
            category: v,
            // Memo follows the category (qualified dividends are always memo); an item
            // returned to its own category gets its stored flag back.
            memo: item && v === item.category && "is_memo" in item ? item.is_memo : v === "qualified_dividends",
          })
        }
        className="w-52"
      />
      <TextField
        label="Box"
        value={draft.box}
        maxLength={8}
        onChange={(e) => set({ box: e.target.value })}
        className="w-16"
      />
      <TextField
        label="Label"
        value={draft.label}
        maxLength={80}
        onChange={(e) => set({ label: e.target.value })}
        className="w-40"
      />
      <TextField
        label="Amount ($)"
        inputMode="decimal"
        value={draft.amount}
        onChange={(e) => set({ amount: e.target.value })}
        error={touched || item ? (dirty ? err : null) : null}
        className="w-32"
      />
      {kind === "tax" ? (
        <TextField
          label="Jurisdiction"
          value={draft.jurisdiction}
          maxLength={40}
          onChange={(e) => set({ jurisdiction: e.target.value })}
          className="w-28"
        />
      ) : (
        <label className="flex items-center gap-1 self-center pt-4 text-xs text-muted-foreground">
          <input type="checkbox" checked={draft.memo} onChange={(e) => set({ memo: e.target.checked })} />
          Memo (not in total)
        </label>
      )}
      <span className="flex items-center gap-2 self-end pb-0.5">
        {origin ? <Badge variant={item?.origin === "llm" ? "accent" : "secondary"}>{origin}</Badge> : null}
        {dirty ? (
          <Button type="submit" size="sm" disabled={busy}>
            {item ? "Save item" : `Add ${kind} item`}
          </Button>
        ) : null}
        {item ? (
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void remove()}>
            Delete item
          </Button>
        ) : (
          <Button type="button" size="sm" variant="outline" onClick={onDone}>
            Cancel
          </Button>
        )}
      </span>
    </form>
  );
}

export function ItemTable({
  kind,
  items,
  formId,
}: {
  kind: Kind;
  items: readonly Item[];
  formId: number;
}) {
  const [adding, setAdding] = React.useState(false);
  const title = kind === "income" ? "Income items" : "Tax items";
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase text-muted-foreground">{title}</h4>
      {items.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">None.</p>
      ) : null}
      {items.map((it) => (
        <ItemRow key={`${it.id}:${itemSignature(it)}`} kind={kind} item={it} formId={formId} />
      ))}
      {adding ? (
        <ItemRow kind={kind} item={null} formId={formId} onDone={() => setAdding(false)} />
      ) : (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={() => setAdding(true)}>
            {kind === "income" ? "Add income item" : "Add tax item"}
          </Button>
        </div>
      )}
    </section>
  );
}
