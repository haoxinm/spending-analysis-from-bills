import * as React from "react";
import { useSearchParams } from "react-router-dom";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/primitives/states";

import { useStatement, useStatementsForDrift } from "./api";
import { computeDrift, findPreviousStatement } from "./drift";
import { DriftBanner } from "./drift-banner";
import { ManualMapperForm } from "./manual-mapper-form";
import { type PasteSpecResult, PasteSpecPanel } from "./paste-spec-panel";
import { SavePanel } from "./save-panel";
import { emptySpec, type LayoutSpecObject } from "./spec-types";
import { validateSpec } from "./spec-validate";
import { TestExtractPanel } from "./test-extract-panel";
import { stringifySpec } from "./yaml";

type MapperTab = "manual" | "paste";

/**
 * The layout mapper (P3-G, §2d.2): for a statement no built-in parser could confidently read
 * (`unsupported_layout` / low `detect_score`), map columns manually or paste a spec obtained
 * elsewhere, save it as a local layout spec, and optionally contribute it upstream. No AI button
 * (A32/D13 — that is P5-C, a later, optional phase).
 *
 * Known gap, degraded gracefully: there is no API endpoint returning a statement's extracted
 * words/coordinates or a dry-run parse preview, so this screen cannot show a click-to-map
 * rendering of the actual statement or a true "N transactions, no side effects" live preview.
 * See this WP's final report for the exact endpoints that would remove both limitations.
 */
export default function LayoutMapperScreen() {
  const [searchParams] = useSearchParams();
  const statementIdParam = searchParams.get("statement_id");
  const statementId = statementIdParam ? Number(statementIdParam) : null;
  const statementIdValid = statementId != null && Number.isInteger(statementId);

  const statementQuery = useStatement(statementIdValid ? statementId : null);
  const statement = statementQuery.data ?? null;

  const statementsForDrift = useStatementsForDrift(statement?.user_id ?? null);

  const [tab, setTab] = React.useState<MapperTab>("manual");
  const [manualSpec, setManualSpec] = React.useState<LayoutSpecObject>(emptySpec);
  const [pasteResult, setPasteResult] = React.useState<PasteSpecResult | null>(null);
  const [issuerId, setIssuerId] = React.useState("");
  const [savedSpecId, setSavedSpecId] = React.useState<number | null>(null);

  const activeSpec: LayoutSpecObject | null =
    tab === "manual"
      ? manualSpec
      : pasteResult && pasteResult.errors.length === 0 && pasteResult.parsed !== null
        ? (pasteResult.parsed as LayoutSpecObject)
        : null;
  const activeErrors = tab === "manual" ? validateSpec(manualSpec) : pasteResult?.errors ?? [];
  const activeYaml =
    tab === "manual" ? stringifySpec(manualSpec) : (pasteResult?.text ?? "");

  if (!statementIdValid) {
    return (
      <div className="flex flex-col gap-4 py-2">
        <h1 className="text-xl font-semibold tracking-tight">Layout mapper</h1>
        <EmptyState
          title="No statement selected"
          description={
            'Open this screen from Import\'s "unsupported layout" action, or add ?statement_id=<id> to the URL.'
          }
        />
      </div>
    );
  }

  if (statementQuery.isLoading) {
    return <LoadingState />;
  }

  if (statementQuery.isError || statement === null) {
    return (
      <ErrorState
        title="Could not load this statement"
        description={statementQuery.error instanceof Error ? statementQuery.error.message : undefined}
        onRetry={() => void statementQuery.refetch()}
      />
    );
  }

  const previous = statementsForDrift.data ? findPreviousStatement(statementsForDrift.data, statement) : null;
  const drift = computeDrift(statement, previous ?? null);

  return (
    <div className="flex flex-col gap-4 py-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Layout mapper</h1>
        <p className="text-sm text-muted-foreground">
          Statement #{statement.id} — status: {statement.status}
          {statement.detect_score != null ? `, best parser confidence ${statement.detect_score.toFixed(2)}` : ""}
        </p>
      </div>

      <DriftBanner drift={drift} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Build a layout spec</CardTitle>
          <div className="flex gap-1">
            <TabButton active={tab === "manual"} onClick={() => setTab("manual")}>
              Map columns
            </TabButton>
            <TabButton active={tab === "paste"} onClick={() => setTab("paste")}>
              Paste a layout spec
            </TabButton>
          </div>
        </CardHeader>
        <CardContent>
          {tab === "manual" ? (
            <ManualMapperForm spec={manualSpec} onChange={setManualSpec} />
          ) : (
            <PasteSpecPanel onResult={setPasteResult} />
          )}
        </CardContent>
      </Card>

      <SavePanel
        spec={activeSpec}
        specErrors={activeErrors}
        specYaml={activeYaml}
        issuerId={issuerId}
        onIssuerIdChange={setIssuerId}
        onSaved={setSavedSpecId}
      />

      <TestExtractPanel
        statement={statement}
        layoutSpecId={savedSpecId}
        issuerId={issuerId ? Number(issuerId) : null}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        active
          ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
          : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
      }
    >
      {children}
    </button>
  );
}

export const screenMeta = { path: "/layout-mapper", title: "Layout mapper" };
