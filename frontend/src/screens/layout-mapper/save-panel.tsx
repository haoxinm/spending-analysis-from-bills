import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/use-toast";

import { useApproveLayoutSpec, useCreateLayoutSpec, useIssuers, useLayoutSpecs, useReviseLayoutSpec, exportLayoutSpec } from "./api";
import { generateSyntheticFixture } from "./fixture";
import type { LayoutSpecObject, SpecFieldError } from "./spec-types";

function downloadTextFile(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Saves a validated spec as a local layout spec (§2d.2 step 2, A19/A21). Every save — hand-mapped
 * or pasted — lands `approved=false` until the "Approve" step below (§2d.2 step 4). Also offers
 * "Contribute this layout" (§2d.2 step 3): exports the spec plus a synthetic fixture, never the
 * real statement.
 */
export function SavePanel({
  spec,
  specErrors,
  specYaml,
  issuerId,
  onIssuerIdChange,
  onSaved,
}: {
  spec: LayoutSpecObject | null;
  specErrors: SpecFieldError[];
  specYaml: string;
  issuerId: string;
  onIssuerIdChange: (issuerId: string) => void;
  onSaved?: (specId: number) => void;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [revisingId, setRevisingId] = React.useState<string>("");

  const issuers = useIssuers();
  const layoutSpecs = useLayoutSpecs();
  const createSpec = useCreateLayoutSpec();
  const reviseSpec = useReviseLayoutSpec();
  const approveSpec = useApproveLayoutSpec();

  const canSave = spec !== null && specErrors.length === 0 && name.trim() !== "";

  async function handleSave(): Promise<void> {
    if (!canSave) return;
    try {
      const body = {
        name: name.trim(),
        spec_yaml: specYaml,
        issuer_id: issuerId ? Number(issuerId) : null,
      };
      const saved = revisingId
        ? await reviseSpec.mutateAsync({ specId: Number(revisingId), body })
        : await createSpec.mutateAsync(body);
      toast({
        title: "Saved",
        description: `Saved as ${saved?.name ?? name} v${saved?.version ?? "?"} (unapproved).`,
      });
      if (saved?.id != null) onSaved?.(saved.id);
    } catch (exc) {
      toast({ title: "Could not save", description: String(exc), variant: "destructive" });
    }
  }

  async function handleApprove(specId: number): Promise<void> {
    try {
      await approveSpec.mutateAsync(specId);
      toast({ title: "Approved", description: "This spec version is now eligible to parse imports (§2f.1)." });
    } catch (exc) {
      toast({ title: "Could not approve", description: String(exc), variant: "destructive" });
    }
  }

  function handleContribute(): void {
    if (spec === null) return;
    const fixture = generateSyntheticFixture(spec, specYaml);
    downloadTextFile(`${spec.id || "layout_spec"}-contribution.txt`, fixture);
  }

  async function handleExport(specId: number, specName: string, version: number): Promise<void> {
    try {
      const yaml = await exportLayoutSpec(specId);
      downloadTextFile(`${specName}-v${version}.yaml`, yaml);
    } catch (exc) {
      toast({ title: "Could not export", description: String(exc), variant: "destructive" });
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <h3 className="text-sm font-semibold">Save as a local layout spec</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Bank credit card" className="w-56" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Issuer (optional)
          <select
            value={issuerId}
            onChange={(e) => onIssuerIdChange(e.target.value)}
            className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">(none)</option>
            {(issuers.data ?? []).map((issuer) => (
              <option key={issuer.id} value={issuer.id}>
                {issuer.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Revise an existing spec instead (optional — inserts version + 1, A21)
          <select
            value={revisingId}
            onChange={(e) => setRevisingId(e.target.value)}
            className="h-9 w-64 rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">(save as a new spec)</option>
            {(layoutSpecs.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} v{s.version} {s.approved ? "(approved)" : "(unapproved)"}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => void handleSave()} disabled={!canSave || createSpec.isPending || reviseSpec.isPending}>
          {revisingId ? "Save as next version" : "Save"}
        </Button>
        <Button variant="outline" onClick={handleContribute} disabled={spec === null}>
          Contribute this layout (export)
        </Button>
      </div>
      {specErrors.length > 0 ? (
        <p className="text-xs text-destructive">Fix the {specErrors.length} problem(s) above before saving.</p>
      ) : null}

      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-muted-foreground">Existing layout specs</p>
        {(layoutSpecs.data ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">None saved yet.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {(layoutSpecs.data ?? []).map((s) => (
              <li key={s.id} className="flex items-center gap-2 text-xs">
                <span>
                  {s.name} v{s.version} — {s.approved ? "approved" : "not approved"} ({s.source})
                </span>
                {!s.approved ? (
                  <Button size="sm" variant="ghost" onClick={() => void handleApprove(s.id)}>
                    Approve
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" onClick={() => void handleExport(s.id, s.name, s.version)}>
                  Export YAML
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
