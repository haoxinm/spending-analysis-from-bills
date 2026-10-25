import * as React from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { useImportSettings, useLlmPreview, useStatementPages } from "./api";
import { formatPageRanges, parsePageRanges } from "./page-ranges";
import { pageImageUrl } from "./spend-token";
import type { ImportItem } from "./types";
import type { Action } from "./use-import-queue";
import { isLlmChoice } from "./use-import-queue";

const THUMB_WIDTH = 160;

function hostOf(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function LlmNotice({ item, pages }: { item: ImportItem; pages: number[] | null }) {
  const settings = useImportSettings();
  const [open, setOpen] = React.useState(false);
  const preview = useLlmPreview(item.statementId, pages, open);
  const mode = settings.data?.llm.mode;
  const resolvedUrl = preview.data?.resolved_url ?? settings.data?.llm.base_url ?? "";

  return (
    <div className="flex flex-col gap-2 rounded-md border border-input p-3 text-xs">
      {mode === "local" ? (
        <p className="text-muted-foreground">
          Page text is sent only to your local model at {resolvedUrl}
        </p>
      ) : mode === "remote" ? (
        <p role="alert" className="text-destructive">
          The text of the selected pages is sent to {hostOf(resolvedUrl)}. Account numbers and
          emails are masked first.
        </p>
      ) : null}
      <button
        type="button"
        className="self-start underline"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Preview what will be sent
      </button>
      {open ? (
        preview.isPending ? (
          <p className="text-muted-foreground">Loading preview…</p>
        ) : preview.isError ? (
          <p className="text-destructive">Could not load the preview.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-muted-foreground">
              {preview.data.requests.length} request{preview.data.requests.length === 1 ? "" : "s"} ·{" "}
              {preview.data.total_chars} characters total
            </p>
            {preview.data.requests.map((text, index) => (
              <pre
                key={index}
                data-testid="llm-request"
                className="max-h-60 overflow-auto whitespace-pre-wrap rounded bg-muted p-2"
              >
                {text}
              </pre>
            ))}
          </div>
        )
      ) : null}
    </div>
  );
}

export interface PageSelectorProps {
  item: ImportItem;
  dispatch: React.Dispatch<Action>;
}

/** Per-statement page selection (thumbnail grid, All/None, range input) plus the LLM privacy
 * notice and "Preview what will be sent" disclosure when the LLM extractor is chosen. */
export function PageSelector({ item, dispatch }: PageSelectorProps) {
  const isLlm = isLlmChoice(item.extractorChoice);
  const pageCount = item.statement?.page_count ?? null;
  const visible = item.status === "awaiting_extractor" && (isLlm || (pageCount ?? 0) > 1);
  const pagesQuery = useStatementPages(item.statementId, visible);
  const infos = pagesQuery.data ?? [];
  const total = pageCount ?? infos.length;
  const allPages = React.useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);
  const selected = item.selectedPages ?? allPages;
  const [rangeText, setRangeText] = React.useState<string | null>(null);

  if (!visible || item.statementId === undefined) return null;

  const apply = (pages: number[], syncText = true) => {
    const sorted = [...pages].sort((a, b) => a - b);
    dispatch({
      type: "pages_selected",
      clientId: item.clientId,
      pages: sorted.length === total ? null : sorted,
    });
    if (syncText) setRangeText(null);
  };
  const shownText = rangeText ?? (item.selectedPages == null ? "" : formatPageRanges(selected));
  const invalidRange = rangeText !== null && parsePageRanges(rangeText, total) === null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
        <span>
          Pages ({selected.length} of {total} selected)
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => apply(allPages)}>
          All
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => apply([])}>
          None
        </Button>
        <Input
          aria-label="Page ranges"
          placeholder="e.g. 1-3,5 (blank = all)"
          className="h-8 w-48 text-sm"
          aria-invalid={invalidRange}
          value={shownText}
          onChange={(event) => {
            const text = event.target.value;
            setRangeText(text);
            if (text.trim() === "") {
              apply(allPages, false);
              return;
            }
            const parsed = parsePageRanges(text, total);
            if (parsed) apply(parsed, false);
          }}
        />
      </div>
      {selected.length === 0 ? (
        <p role="alert" className="text-xs text-destructive">
          Select at least one page to import.
        </p>
      ) : null}
      <div className="grid max-h-96 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4 lg:grid-cols-6">
        {allPages.map((pageNumber) => {
          const info = infos.find((p) => p.page_number === pageNumber);
          const checked = selected.includes(pageNumber);
          return (
            <label
              key={pageNumber}
              title={info?.snippet}
              className="flex cursor-pointer flex-col gap-1 rounded-md border border-input p-1.5 text-xs"
            >
              <img
                src={pageImageUrl(item.statementId as number, pageNumber, THUMB_WIDTH)}
                alt={`Page ${pageNumber} preview`}
                loading="lazy"
                width={THUMB_WIDTH}
                className="w-full bg-muted"
              />
              <span className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  aria-label={`Page ${pageNumber}`}
                  checked={checked}
                  onChange={() =>
                    apply(checked ? selected.filter((n) => n !== pageNumber) : [...selected, pageNumber])
                  }
                />
                Page {pageNumber}
                {info ? <span className="text-muted-foreground">· {info.char_count} chars</span> : null}
              </span>
            </label>
          );
        })}
      </div>
      {isLlm ? <LlmNotice item={item} pages={item.selectedPages ?? null} /> : null}
    </div>
  );
}
