import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";

import {
  useConfirmTaxForm,
  useDeleteTaxForm,
  useUpdateTaxForm,
  type TaxFormPatch,
} from "../hooks";
import {
  FILING_STATUS_OPTIONS,
  FORM_TYPE_OPTIONS,
  blankToNull,
  dollarsToMinor,
  errorMessage,
  formTypeLabel,
  last4Error,
  minorToDollars,
  provenanceLabel,
  taxYearError,
  type FilingStatus,
  type TaxFormDetail,
  type TaxFormType,
} from "../logic";
import { SelectField, TextField } from "./fields";
import { ItemTable } from "./item-table";

interface Draft {
  formType: TaxFormType;
  taxYear: string;
  payer: string;
  payerLast4: string;
  accountLast4: string;
  corrected: boolean;
  filingStatus: FilingStatus | "";
  agi: string;
  taxable: string;
}

function draftOf(f: TaxFormDetail): Draft {
  return {
    formType: f.form_type,
    taxYear: String(f.tax_year),
    payer: f.payer_name ?? "",
    payerLast4: f.payer_tin_last4 ?? "",
    accountLast4: f.account_last4 ?? "",
    corrected: f.is_corrected,
    filingStatus: (f.filing_status as FilingStatus | null) ?? "",
    agi: f.agi_minor === null ? "" : minorToDollars(f.agi_minor),
    taxable:
      f.taxable_income_minor === null
        ? ""
        : minorToDollars(f.taxable_income_minor),
  };
}

function moneyError(text: string, allowNegative = true): string | null {
  if (text.trim() === "" || dollarsToMinor(text, allowNegative) !== null)
    return null;
  return !allowNegative && dollarsToMinor(text, true) !== null
    ? "Amount cannot be negative"
    : "Enter a valid dollar amount";
}

function FormFields({
  formId,
  form,
  siblings,
  ownerId,
}: {
  formId: number;
  form: TaxFormDetail;
  siblings: number;
  ownerId?: number;
}) {
  const { toast } = useToast();
  const update = useUpdateTaxForm(ownerId);
  const initial = React.useMemo(() => draftOf(form), [form]);
  const [draft, setDraft] = React.useState(initial);
  const set = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  const errors = {
    taxYear: taxYearError(draft.taxYear),
    payerLast4: last4Error(draft.payerLast4),
    accountLast4: last4Error(draft.accountLast4),
    agi: moneyError(draft.agi),
    taxable: moneyError(draft.taxable, false),
  };
  const invalid = Object.values(errors).some(Boolean);
  const is1040 = draft.formType === "1040";

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (invalid) return;
    const patch: TaxFormPatch = {};
    if (draft.formType !== initial.formType) patch.form_type = draft.formType;
    if (draft.taxYear !== initial.taxYear)
      patch.tax_year = Number(draft.taxYear);
    if (draft.payer !== initial.payer)
      patch.payer_name = blankToNull(draft.payer);
    if (draft.payerLast4 !== initial.payerLast4)
      patch.payer_tin_last4 = blankToNull(draft.payerLast4);
    if (draft.accountLast4 !== initial.accountLast4)
      patch.account_last4 = blankToNull(draft.accountLast4);
    if (draft.corrected !== initial.corrected)
      patch.is_corrected = draft.corrected;
    if (draft.filingStatus !== initial.filingStatus)
      patch.filing_status = draft.filingStatus || null;
    if (draft.agi !== initial.agi)
      patch.agi_minor = draft.agi.trim()
        ? dollarsToMinor(draft.agi, true)
        : null;
    if (draft.taxable !== initial.taxable) {
      patch.taxable_income_minor = draft.taxable.trim()
        ? dollarsToMinor(draft.taxable)
        : null;
    }
    try {
      await update.mutateAsync({ formId, patch });
      const moved = patch.tax_year !== undefined && siblings > 0;
      toast({
        variant: "success",
        title: "Form updated",
        description: moved
          ? `All ${siblings + 1} forms in this file moved to tax year ${patch.tax_year}.`
          : undefined,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not save form",
        description: errorMessage(err),
      });
    }
  }

  return (
    <form
      onSubmit={(e) => void save(e)}
      aria-label="Form details"
      className="flex flex-wrap items-start gap-2"
    >
      <SelectField
        label="Form type"
        value={draft.formType}
        options={FORM_TYPE_OPTIONS}
        onChange={(v) => v && set({ formType: v })}
        className="w-40"
      />
      <TextField
        label="Tax year"
        inputMode="numeric"
        value={draft.taxYear}
        error={errors.taxYear}
        onChange={(e) => set({ taxYear: e.target.value })}
        className="w-20"
      />
      <TextField
        label="Payer name"
        value={draft.payer}
        maxLength={120}
        onChange={(e) => set({ payer: e.target.value })}
        className="w-52"
      />
      <TextField
        label="Payer ID last 4"
        inputMode="numeric"
        maxLength={4}
        value={draft.payerLast4}
        error={errors.payerLast4}
        onChange={(e) => set({ payerLast4: e.target.value })}
        className="w-24"
      />
      <TextField
        label="Account last 4"
        inputMode="numeric"
        maxLength={4}
        value={draft.accountLast4}
        error={errors.accountLast4}
        onChange={(e) => set({ accountLast4: e.target.value })}
        className="w-24"
      />
      {is1040 ? (
        <>
          <SelectField
            label="Filing status"
            value={draft.filingStatus}
            options={FILING_STATUS_OPTIONS}
            placeholder="Not set"
            onChange={(v) => set({ filingStatus: v })}
            className="w-44"
          />
          <TextField
            label="AGI ($)"
            inputMode="decimal"
            value={draft.agi}
            error={errors.agi}
            onChange={(e) => set({ agi: e.target.value })}
            className="w-28"
          />
          <TextField
            label="Taxable income ($)"
            inputMode="decimal"
            value={draft.taxable}
            error={errors.taxable}
            onChange={(e) => set({ taxable: e.target.value })}
            className="w-32"
          />
        </>
      ) : null}
      <label className="flex items-center gap-1 self-center pt-4 text-xs text-muted-foreground">
        <input
          type="checkbox"
          checked={draft.corrected}
          onChange={(e) => set({ corrected: e.target.checked })}
        />
        Corrected
      </label>
      {dirty ? (
        <Button
          type="submit"
          size="sm"
          className="self-end"
          disabled={update.isPending}
        >
          Save form
        </Button>
      ) : null}
    </form>
  );
}

/** `siblings`: how many other forms the document holds (they move with this form's tax year). */
export function FormCard({
  form,
  siblings = 0,
  ownerId,
}: {
  form: TaxFormDetail;
  siblings?: number;
  /** The owning user of the document; sent with every mutation as the ownership check. */
  ownerId?: number;
}) {
  const { toast } = useToast();
  const remove = useDeleteTaxForm(ownerId);
  const confirm = useConfirmTaxForm(ownerId);
  const [confirmingDelete, setConfirmingDelete] = React.useState(false);
  const title = `${formTypeLabel(form.form_type)}${form.payer_name ? ` · ${form.payer_name}` : ""}`;

  async function onDelete() {
    try {
      await remove.mutateAsync(form.id);
      toast({ title: "Form deleted" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not delete form",
        description: errorMessage(e),
      });
    }
  }

  async function onConfirm() {
    try {
      await confirm.mutateAsync(form.id);
      toast({ variant: "success", title: "Values confirmed" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not confirm values",
        description: errorMessage(e),
      });
    }
  }

  return (
    <section
      aria-label={`Form: ${title}`}
      className="flex flex-col gap-3 rounded-md border border-border p-3"
    >
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <Badge variant={form.needs_review ? "destructive" : "secondary"}>
          {provenanceLabel(form)}
        </Badge>
        <span className="ml-auto flex items-center gap-2">
          {form.needs_review ? (
            <Button
              size="sm"
              disabled={confirm.isPending}
              onClick={() => void onConfirm()}
            >
              Confirm values
            </Button>
          ) : null}
          {confirmingDelete ? (
            <>
              <span className="text-xs">Delete this form and its figures?</span>
              <Button
                size="sm"
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => void onDelete()}
              >
                Confirm delete form
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setConfirmingDelete(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirmingDelete(true)}
            >
              Delete form
            </Button>
          )}
        </span>
      </header>
      <FormFields
        key={JSON.stringify([
          form.form_type,
          form.tax_year,
          form.payer_name,
          form.payer_tin_last4,
          form.account_last4,
          form.is_corrected,
          form.filing_status,
          form.agi_minor,
          form.taxable_income_minor,
        ])}
        formId={form.id}
        form={form}
        siblings={siblings}
        ownerId={ownerId}
      />
      <ItemTable
        kind="income"
        items={form.income_items}
        formId={form.id}
        ownerId={ownerId}
      />
      <ItemTable
        kind="tax"
        items={form.tax_items}
        formId={form.id}
        ownerId={ownerId}
      />
    </section>
  );
}
