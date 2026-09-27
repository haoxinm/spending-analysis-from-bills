import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/primitives/states";

import { type Settings, useClassifyPreview, useUsersQuery } from "../lib/hooks";
import { buildPreviewCsv, summarizeRedactionSignals } from "../lib/redaction";

export interface EgressPreviewSectionProps {
  settings: Settings;
}

/**
 * "Preview what will be sent" (P3-E section — "the feature that earns user trust; do not cut
 * it"): the literal CSV `classify_batch` would send for the next run, decoded from
 * `GET /api/classify/preview` (no network call, §3.12), plus client-side redaction counters
 * that mirror `egress.py`'s `FORBIDDEN` patterns for transparency (see `lib/redaction.ts`).
 */
export function EgressPreviewSection({ settings }: EgressPreviewSectionProps) {
  const usersQuery = useUsersQuery();
  const [userId, setUserId] = React.useState<string>("");
  const previewQuery = useClassifyPreview({ userId: userId ? Number(userId) : undefined });

  const mode = settings.llm.mode;
  const descriptions = React.useMemo(
    () => previewQuery.data?.map((row) => row.description_clean) ?? [],
    [previewQuery.data],
  );
  const csv = React.useMemo(() => buildPreviewCsv(descriptions), [descriptions]);
  const summary = React.useMemo(() => summarizeRedactionSignals(descriptions), [descriptions]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Preview what will be sent</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {mode === "none" ? (
          <EmptyState
            title="Nothing is ever sent"
            description="LLM mode is 'No LLM — rules only', so classification never leaves this machine. Switch modes above to preview a payload."
          />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              This is exactly what the next classify run would send to <strong>{settings.llm.provider || "the configured provider"}</strong>
              {mode === "local" ? " (running locally — nothing leaves this machine)" : ""}: one row per
              distinct merchant, as <code>description_clean</code> only (I1) — never the raw statement text,
              dates, amounts, issuer names or account identifiers.
            </p>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">Limit preview to one user (optional)</span>
              <select
                className="h-9 w-56 rounded-md border border-input bg-transparent px-2 text-sm"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                <option value="">All users</option>
                {usersQuery.data?.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>

            {previewQuery.isPending ? <LoadingState rows={3} /> : null}
            {previewQuery.isError ? (
              <ErrorState description={String(previewQuery.error)} onRetry={() => void previewQuery.refetch()} />
            ) : null}

            {previewQuery.isSuccess && descriptions.length === 0 ? (
              <EmptyState
                title="Nothing to classify"
                description="No merchants are waiting on classification right now."
              />
            ) : null}

            {previewQuery.isSuccess && descriptions.length > 0 ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{summary.totalRows} row(s)</Badge>
                  <Badge variant={summary.totalFlagged === 0 ? "default" : "destructive"}>
                    {summary.totalFlagged === 0 ? "0 redaction hits" : `${summary.totalFlagged} redaction hit(s)`}
                  </Badge>
                </div>
                <ul className="grid grid-cols-2 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                  {summary.signals.map((signal) => (
                    <li key={signal.key}>
                      {signal.label}: <span className="font-medium text-foreground">{signal.count}</span>
                    </li>
                  ))}
                </ul>
                {summary.totalFlagged > 0 ? (
                  <p className="text-xs font-medium text-destructive">
                    This should never be non-zero — normalization is supposed to strip these before this
                    payload exists. Treat this as a bug report, not a warning to dismiss.
                  </p>
                ) : null}
                <pre
                  data-testid="egress-preview-csv"
                  className="max-h-64 overflow-auto rounded-md border border-border bg-muted p-3 font-mono text-xs"
                >
                  {csv}
                </pre>
                <Button variant="outline" size="sm" onClick={() => void previewQuery.refetch()}>
                  Refresh preview
                </Button>
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
