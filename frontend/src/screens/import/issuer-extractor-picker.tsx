import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useCreateIssuer, useIssuers, useLayoutSpecs } from "./api";
import { extractorChoiceForIssuer } from "./use-import-queue";
import type { ExtractorChoice, ImportItem } from "./types";

export interface IssuerExtractorPickerProps {
  item: ImportItem;
  onIssuerChange: (issuerId: number, extractorChoice: ExtractorChoice | null) => void;
  onExtractorChange: (choice: ExtractorChoice) => void;
}

/** Issuer and extractor override (§2f.2/§2f.4): a select for the matched (or overridden) issuer,
 * an inline "new issuer" form seeded with `match_terms`, and a select for the extractor —
 * either the proposed built-in layout parser or one of that issuer's approved layout specs
 * (§2f.1). Both selects are one click to open; nothing here forces a dialog. */
export function IssuerExtractorPicker({
  item,
  onIssuerChange,
  onExtractorChange,
}: IssuerExtractorPickerProps) {
  const issuersQuery = useIssuers();
  const specsQuery = useLayoutSpecs();
  const createIssuer = useCreateIssuer();
  const [isCreatingIssuer, setIsCreatingIssuer] = React.useState(false);
  const [newIssuerName, setNewIssuerName] = React.useState("");

  const issuers = issuersQuery.data ?? [];
  const specs = specsQuery.data ?? [];
  const specsForIssuer = specs.filter((s) => s.issuer_id === item.issuerId && s.approved);
  const fallbackParserId = item.proposal?.parser_id ?? null;

  const extractorValue =
    item.extractorChoice === null
      ? ""
      : item.extractorChoice.kind === "parser"
        ? `parser:${item.extractorChoice.parserId}`
        : `spec:${item.extractorChoice.layoutSpecId}`;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
        Issuer
        {isCreatingIssuer ? (
          <div className="flex gap-1.5">
            <Input
              autoFocus
              placeholder="Issuer name, e.g. Bank of America"
              value={newIssuerName}
              onChange={(event) => setNewIssuerName(event.target.value)}
              className="h-8 text-sm"
            />
            <Button
              type="button"
              size="sm"
              disabled={newIssuerName.trim().length === 0 || createIssuer.isPending}
              onClick={() => {
                const name = newIssuerName.trim();
                createIssuer.mutate(
                  { name, match_terms: [name.toLowerCase()] },
                  {
                    onSuccess: (issuer) => {
                      setIsCreatingIssuer(false);
                      setNewIssuerName("");
                      onIssuerChange(
                        issuer.id,
                        extractorChoiceForIssuer(issuer.id, specs, fallbackParserId),
                      );
                    },
                  },
                );
              }}
            >
              Add
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setIsCreatingIssuer(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex gap-1.5">
            <select
              className="h-8 flex-1 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
              value={item.issuerId ?? ""}
              onChange={(event) => {
                const issuerId = Number(event.target.value);
                onIssuerChange(issuerId, extractorChoiceForIssuer(issuerId, specs, fallbackParserId));
              }}
            >
              <option value="" disabled>
                {item.issuerId === null ? "Select an issuer…" : ""}
              </option>
              {issuers.map((issuer) => (
                <option key={issuer.id} value={issuer.id}>
                  {issuer.name}
                </option>
              ))}
            </select>
            <Button type="button" size="sm" variant="outline" onClick={() => setIsCreatingIssuer(true)}>
              New
            </Button>
          </div>
        )}
      </label>

      <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
        Extractor
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm text-foreground"
          value={extractorValue}
          disabled={item.issuerId === null}
          onChange={(event) => {
            const [kind, rest] = event.target.value.split(":", 2);
            if (kind === "parser" && rest) {
              onExtractorChange({ kind: "parser", parserId: rest });
            } else if (kind === "spec" && rest) {
              onExtractorChange({ kind: "spec", layoutSpecId: Number(rest) });
            }
          }}
        >
          <option value="" disabled>
            Select an extractor…
          </option>
          {fallbackParserId !== null ? (
            <option value={`parser:${fallbackParserId}`}>
              Auto-detected: {fallbackParserId}
              {item.proposal ? ` (${Math.round(item.proposal.confidence * 100)}% match)` : ""}
            </option>
          ) : null}
          {specsForIssuer.map((spec) => (
            <option key={spec.id} value={`spec:${spec.id}`}>
              {spec.name} v{spec.version}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
