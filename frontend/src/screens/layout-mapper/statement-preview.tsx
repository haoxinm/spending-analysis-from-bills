import * as React from "react";

import type { components } from "@/api/client";
import { EmptyState, LoadingState } from "@/components/primitives/states";

import { useStatementPreview } from "./api";
import type { ColumnSpec } from "./spec-types";

type StatementPreviewWord = components["schemas"]["StatementPreviewWord"];

/** How wide the rendered page is, in CSS pixels — the PDF-point coordinates from
 * `GET /statements/{id}/preview` (§3.12) are scaled into this box, preserving aspect ratio. */
const RENDER_WIDTH = 640;

/**
 * Click-to-map (§2d.2 step 2): renders a statement page's extracted words (`GET
 * /statements/{id}/preview`, §3.12) at their real positions, and turns a click on one into that
 * column's `x0`/`x1` — the column boundaries no longer have to be read off a PDF viewer's ruler
 * by eye.
 */
export function StatementPreview({
  statementId,
  activeColumn,
  onMapColumn,
}: {
  statementId: number;
  /** The column a click should map into, or `null` to disable click-to-map. */
  activeColumn: ColumnSpec | null;
  onMapColumn: (bounds: { x0: number; x1: number }) => void;
}) {
  const [page, setPage] = React.useState(1);
  const previewQuery = useStatementPreview(statementId, page);

  if (previewQuery.isLoading) return <LoadingState rows={6} />;
  if (previewQuery.isError || !previewQuery.data) {
    return (
      <EmptyState
        title="No statement preview available"
        description="The statement's extracted text could not be loaded for click-to-map; column boundaries can still be typed in below by eye."
      />
    );
  }

  const { width, height, words } = previewQuery.data;
  const scale = width > 0 ? RENDER_WIDTH / width : 1;
  const renderHeight = height * scale;

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">
        {activeColumn
          ? `Click a word below to set "${activeColumn.name || "this column"}"'s x0/x1 from its bounds.`
          : "Pick \"Map from preview\" on a column below, then click a word here."}
      </p>
      <div
        className="relative overflow-auto rounded-md border border-border bg-card"
        style={{ width: RENDER_WIDTH, height: Math.min(renderHeight, 480) }}
      >
        {words.map((word: StatementPreviewWord, i) => (
          <button
            key={i}
            type="button"
            title={`x0=${word.x0.toFixed(1)} x1=${word.x1.toFixed(1)}`}
            disabled={!activeColumn}
            onClick={() => onMapColumn({ x0: word.x0, x1: word.x1 })}
            className="absolute overflow-hidden whitespace-nowrap border-0 bg-transparent p-0 text-left font-mono text-[9px] leading-none text-foreground hover:bg-primary/20 hover:outline hover:outline-1 hover:outline-primary disabled:cursor-default disabled:hover:bg-transparent disabled:hover:outline-0"
            style={{
              left: word.x0 * scale,
              top: word.top * scale,
              width: Math.max((word.x1 - word.x0) * scale, 4),
              height: Math.max((word.bottom - word.top) * scale, 8),
            }}
          >
            {word.text}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1 disabled:opacity-40"
          disabled={page <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
        >
          Previous page
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          className="rounded-md border border-border px-2 py-1"
          onClick={() => setPage((p) => p + 1)}
        >
          Next page
        </button>
      </div>
    </div>
  );
}
