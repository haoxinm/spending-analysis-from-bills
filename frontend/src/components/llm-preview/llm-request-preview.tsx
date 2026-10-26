import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { components } from "@/api/client";
import { Button } from "@/components/ui/button";

import { hostOf } from "./host";

export type LlmParsePreview = components["schemas"]["LlmParsePreview"];
export type LlmMode = "none" | "local" | "remote";

const MODE_LABEL: Record<LlmMode, string> = {
  none: "No LLM configured",
  local: "Local model",
  remote: "Remote model",
};

export interface LlmEgressNoticeProps {
  mode: LlmMode | undefined;
  /** The endpoint the text goes to (shown as a host for a remote model). */
  url: string;
  /** What is masked before sending, e.g. "Account numbers and emails". */
  masked: string;
  subject?: string;
}

/** The privacy line above a preview: remote = warning, local = reassurance, none = nothing. */
export function LlmEgressNotice({
  mode,
  url,
  masked,
  subject = "The text of the selected pages",
}: LlmEgressNoticeProps) {
  if (mode === "local") {
    return (
      <p className="text-xs text-muted-foreground">
        Page text is sent only to your local model at {url}
      </p>
    );
  }
  if (mode === "remote") {
    return (
      <p role="alert" className="text-xs text-destructive">
        {subject} is sent to {hostOf(url)}. {masked} are masked first.
      </p>
    );
  }
  return null;
}

export interface LlmRequestPreviewProps {
  /** Identifies this preview (document + selection) so each selection is cached separately. */
  queryKey: readonly unknown[];
  /** Loads the preview. Called only after the user expands the section. */
  fetchPreview: () => Promise<LlmParsePreview>;
  /** False disables the section (for example while no page is selected). */
  enabled?: boolean;
  /** Known before loading, for the always-visible summary. */
  mode?: LlmMode;
  endpoint?: string;
  selectedPageCount?: number;
  /** Start expanded (default collapsed). */
  defaultOpen?: boolean;
  /**
   * Reports whether the shown preview is still loading for the *current* key (only while the
   * section is expanded and enabled; a collapsed preview never blocks). Hosts disable their
   * Send/Confirm button while it is true, so what is sent can never differ from what is shown.
   */
  onPendingChange?: (pending: boolean) => void;
}

/**
 * "Show what would be sent": collapsed by default; the summary line (model, endpoint, pages, size,
 * redactions) stays visible. The request bodies are fetched only after expanding and shown in one
 * fixed-height scrollable monospace region, so a large document never floods the page.
 */
export function LlmRequestPreview({
  queryKey,
  fetchPreview,
  enabled = true,
  mode,
  endpoint = "",
  selectedPageCount,
  defaultOpen = false,
  onPendingChange,
}: LlmRequestPreviewProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const regionId = React.useId();
  const preview = useQuery({
    queryKey: ["llm-preview", ...queryKey],
    enabled: open && enabled,
    queryFn: fetchPreview,
    // What would be sent depends on settings and personal-info entries that change elsewhere, so
    // a preview is never served from cache; and a previous selection's text is never shown as
    // the current one (no placeholder data).
    staleTime: 0,
    gcTime: 0,
  });
  const data = enabled ? preview.data : undefined;
  const pending =
    open && enabled && (preview.isPending || preview.isPlaceholderData);
  React.useEffect(() => {
    onPendingChange?.(pending);
    return () => onPendingChange?.(false);
  }, [pending, onPendingChange]);
  const shownMode = data?.mode ?? mode;
  const url = data?.resolved_url || endpoint;
  const pageCount = data?.pages.length ?? selectedPageCount;

  return (
    <div
      className="flex flex-col gap-2 text-xs"
      data-testid="llm-request-preview"
    >
      <p
        className="flex flex-wrap items-center gap-x-2 text-muted-foreground"
        data-testid="llm-preview-summary"
      >
        {shownMode ? <span>{MODE_LABEL[shownMode]}</span> : null}
        {data?.model ? <span>{data.model}</span> : null}
        {url && shownMode !== "none" ? <span>{hostOf(url)}</span> : null}
        {pageCount !== undefined ? (
          <span>
            {pageCount} page{pageCount === 1 ? "" : "s"}
          </span>
        ) : null}
        {data ? (
          <>
            <span>
              {data.requests.length} request
              {data.requests.length === 1 ? "" : "s"}
            </span>
            <span>{data.total_chars} characters total</span>
            <span data-testid="llm-redactions">
              {data.redactions} personal-info{" "}
              {data.redactions === 1 ? "match" : "matches"} removed
            </span>
          </>
        ) : null}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="self-start underline disabled:opacity-50"
          aria-expanded={open}
          aria-controls={regionId}
          disabled={!enabled}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Hide what would be sent" : "Show what would be sent"}
        </button>
        {open && data && data.requests.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() =>
              void navigator.clipboard?.writeText(data.requests.join("\n\n"))
            }
          >
            Copy
          </Button>
        ) : null}
      </div>
      <div id={regionId} hidden={!open}>
        {open ? (
          !enabled ? (
            <p className="text-muted-foreground">
              Select at least one page to preview.
            </p>
          ) : pending ? (
            <p className="text-muted-foreground" role="status">
              Loading preview…
            </p>
          ) : preview.isError ? (
            <p className="text-destructive">Could not load the preview.</p>
          ) : data && data.requests.length === 0 ? (
            <p className="text-muted-foreground">
              {data.mode === "none"
                ? "No LLM is configured, so nothing would be sent."
                : "Nothing would be sent for this selection."}
            </p>
          ) : data ? (
            <div
              data-testid="llm-preview-scroll"
              tabIndex={0}
              aria-label="Text that would be sent"
              className="flex max-h-96 flex-col gap-2 overflow-auto rounded border border-input p-2"
            >
              {data.requests.map((text, index) => (
                <div key={index} className="flex flex-col gap-1">
                  {data.requests.length > 1 ? (
                    <span className="text-muted-foreground">
                      Request {index + 1} of {data.requests.length} ·{" "}
                      {text.length} characters
                    </span>
                  ) : null}
                  <pre
                    data-testid="llm-request"
                    className="whitespace-pre-wrap break-words rounded bg-muted p-2 font-mono"
                  >
                    {text}
                  </pre>
                </div>
              ))}
            </div>
          ) : null
        ) : null}
      </div>
    </div>
  );
}
