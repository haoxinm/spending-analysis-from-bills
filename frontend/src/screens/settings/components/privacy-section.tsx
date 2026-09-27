import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

import { type PrivacySettings, type Settings } from "../lib/hooks";

export interface PrivacySectionProps {
  settings: Settings;
  onSave: (privacy: PrivacySettings) => void;
  saving: boolean;
}

/** Privacy toggles (P3-E section): whether a copy of each imported PDF is kept, whether the
 * debug-only extract cache is written, and the per-user PII alias terms that feed redaction
 * (D10, A11) alongside `config.toml`'s global `pii_terms`. */
export function PrivacySection({ settings, onSave, saving }: PrivacySectionProps) {
  const [draft, setDraft] = React.useState<PrivacySettings>(settings.privacy);
  const [newTerm, setNewTerm] = React.useState("");

  React.useEffect(() => {
    setDraft(settings.privacy);
  }, [settings.privacy]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings.privacy);

  const addTerm = () => {
    const term = newTerm.trim();
    if (term.length < 3) return; // D10: minimum length 3
    if (draft.pii_terms.includes(term)) {
      setNewTerm("");
      return;
    }
    setDraft((prev) => ({ ...prev, pii_terms: [...prev.pii_terms, term] }));
    setNewTerm("");
  };

  const removeTerm = (term: string) => {
    setDraft((prev) => ({ ...prev, pii_terms: prev.pii_terms.filter((t) => t !== term) }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Privacy</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.store_pdf_copies}
            onChange={(e) => setDraft((prev) => ({ ...prev, store_pdf_copies: e.target.checked }))}
          />
          Keep a copy of each imported statement PDF
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={draft.store_extract_cache}
            onChange={(e) => setDraft((prev) => ({ ...prev, store_extract_cache: e.target.checked }))}
          />
          Cache extracted page text for debugging (off by default)
        </label>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">PII terms (case-insensitive, word-boundary, min 3 chars)</span>
          <p className="text-xs text-muted-foreground">
            Names, nicknames or other identifying words to strip from descriptions before anything is
            classified or sent to an LLM.
          </p>
          <div className="flex flex-wrap gap-2">
            {draft.pii_terms.map((term) => (
              <Badge key={term} variant="secondary" className="gap-1">
                {term}
                <button
                  type="button"
                  aria-label={`Remove ${term}`}
                  className="ml-1 text-muted-foreground hover:text-foreground"
                  onClick={() => removeTerm(term)}
                >
                  ×
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <Input
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              placeholder="e.g. a nickname"
              className="w-48"
              aria-label="New PII term"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTerm();
                }
              }}
            />
            <Button size="sm" variant="secondary" onClick={addTerm} disabled={newTerm.trim().length < 3}>
              Add term
            </Button>
          </div>
        </div>

        <div>
          <Button onClick={() => onSave(draft)} disabled={!dirty || saving}>
            Save privacy settings
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
