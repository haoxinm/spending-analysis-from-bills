import * as React from "react";

import type { components } from "@/api/client";
import { UserSwitcher } from "@/components/primitives/user-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileDropZone } from "@/screens/import/file-drop-zone";

import { useDeleteTaxDocument, useUploadTaxDocument, type TaxImportResponse } from "../hooks";
import { TAX_PRIVACY_NOTE, documentStatusLabel, formTypeLabel, type TaxDocument } from "../logic";

type User = components["schemas"]["User"];

export interface DocumentsPanelProps {
  documents: readonly TaxDocument[];
  users: readonly User[];
  /** Selected user, or null for "All users". */
  selectedUserId: number | null;
}

interface UploadOutcome {
  name: string;
  status: TaxImportResponse["status"] | "failed";
  message: string;
}

function outcomeFor(file: File, r: TaxImportResponse): UploadOutcome {
  switch (r.status) {
    case "parsed":
      return {
        name: file.name,
        status: r.status,
        message: `Imported ${r.inserted_forms} form${r.inserted_forms === 1 ? "" : "s"}.`,
      };
    case "duplicate":
      return { name: file.name, status: r.status, message: "Already imported; nothing changed." };
    default:
      return {
        name: file.name,
        status: r.status,
        message: r.error ?? "This file could not be read as a tax form.",
      };
  }
}

function userName(users: readonly User[], id: number): string {
  return users.find((u) => u.id === id)?.name ?? `User ${id}`;
}

export function DocumentsPanel({ documents, users, selectedUserId }: DocumentsPanelProps) {
  const upload = useUploadTaxDocument();
  const remove = useDeleteTaxDocument();
  // The drop zone needs one concrete user; with "All users" selected the user picks one here.
  const [uploadUser, setUploadUser] = React.useState<number | null>(null);
  const targetUserId = selectedUserId ?? uploadUser ?? users[0]?.id ?? null;
  const [taxYear, setTaxYear] = React.useState("");
  const [outcomes, setOutcomes] = React.useState<UploadOutcome[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [confirmingId, setConfirmingId] = React.useState<number | null>(null);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const yearNumber = taxYear.trim() === "" ? undefined : Number(taxYear);
  const yearInvalid =
    yearNumber !== undefined && (!Number.isInteger(yearNumber) || yearNumber < 1990 || yearNumber > 2100);

  async function onFiles(files: File[]) {
    if (targetUserId === null || yearInvalid) return;
    setUploading(true);
    const results: UploadOutcome[] = [];
    for (const file of files) {
      try {
        const r = await upload.mutateAsync({ file, userId: targetUserId, taxYear: yearNumber });
        results.push(outcomeFor(file, r));
      } catch (e) {
        results.push({
          name: file.name,
          status: "failed",
          message: e instanceof Error ? e.message : "Upload failed.",
        });
      }
    }
    setOutcomes(results);
    setUploading(false);
  }

  async function onDelete(id: number) {
    setDeleteError(null);
    try {
      await remove.mutateAsync(id);
      setConfirmingId(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid="tax-documents">
      <div className="flex flex-col gap-2">
        {selectedUserId === null && users.length > 1 ? (
          <label className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Upload for</span>
            <UserSwitcher
              users={users}
              value={targetUserId}
              onChange={setUploadUser}
              allowAll={false}
              variant="select"
              aria-label="Upload for user"
            />
          </label>
        ) : null}
        <FileDropZone
          onFiles={(f) => void onFiles(f)}
          disabled={uploading || targetUserId === null || yearInvalid}
          title="Drag tax forms here, or click to browse"
          hint="W-2, 1099 and 1040 PDFs with a text layer. Scanned forms can’t be read."
          inputLabel="Choose tax form PDFs"
        />
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Tax year (only if a form doesn’t print one)
          <Input
            type="number"
            inputMode="numeric"
            min={1990}
            max={2100}
            value={taxYear}
            onChange={(e) => setTaxYear(e.target.value)}
            aria-invalid={yearInvalid}
            className="h-8 w-24"
          />
        </label>
        <p className="text-xs text-muted-foreground" data-testid="tax-privacy-note">
          {TAX_PRIVACY_NOTE}
        </p>
        {uploading ? <p role="status" className="text-sm">Reading tax forms…</p> : null}
        {outcomes.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm" data-testid="upload-outcomes">
            {outcomes.map((o, i) => (
              <li key={`${o.name}-${i}`} className={o.status === "parsed" || o.status === "duplicate" ? "" : "text-destructive"}>
                <span className="font-medium">{o.name}</span>: {o.message}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {deleteError ? (
        <p role="alert" className="text-sm text-destructive">
          {deleteError}
        </p>
      ) : null}

      {documents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No tax documents imported yet.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 p-3" data-testid="tax-document">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{d.original_name}</span>
                {d.form_types.map((f) => (
                  <Badge key={f} variant="secondary">
                    {formTypeLabel(f)}
                  </Badge>
                ))}
                <Badge variant={d.status === "parsed" ? "accent" : "destructive"}>
                  {documentStatusLabel(d.status)}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {d.tax_year ?? "year unknown"}
                  {users.length > 1 ? ` · ${userName(users, d.user_id)}` : ""}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {confirmingId === d.id ? (
                    <>
                      <span className="text-xs">Delete this document and its figures?</span>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={remove.isPending}
                        onClick={() => void onDelete(d.id)}
                      >
                        Confirm delete
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmingId(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-label={`Delete ${d.original_name}`}
                      onClick={() => setConfirmingId(d.id)}
                    >
                      Delete
                    </Button>
                  )}
                </span>
              </div>
              {d.error_detail ? <p className="text-xs text-destructive">{d.error_detail}</p> : null}
              {d.warnings.length > 0 ? (
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {d.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
