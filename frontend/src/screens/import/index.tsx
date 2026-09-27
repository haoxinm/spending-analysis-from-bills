import * as React from "react";

import { useUsers } from "@/api/hooks";
import { ErrorState, LoadingState } from "@/components/primitives/states";
import type { JobEvent } from "@/hooks/use-job-progress";

import { useExtractStatement, useUploadStatement } from "./api";
import { FileDropZone } from "./file-drop-zone";
import { IssuerExtractorPicker } from "./issuer-extractor-picker";
import { getStickyUserId, setStickyUserId } from "./storage";
import { StatementCard } from "./statement-card";
import { SummaryBar } from "./summary-bar";
import type { ExtractorChoice, ImportItem } from "./types";
import {
  extractorChoiceFromProposal,
  refreshAfterJob,
  shouldAutoConfirm,
  useImportQueue,
} from "./use-import-queue";

/** The Import screen (P3-A): drag-and-drop multiple statement PDFs, resolve the two-phase
 * import's user choice up front (D4) and its issuer/extractor choice per file (§2f.2), and
 * show live progress and outcomes through to reconciliation. */
function ImportScreen() {
  const usersQuery = useUsers();
  const { items, queueFiles, dispatch } = useImportQueue();
  const uploadStatement = useUploadStatement();
  const extractStatement = useExtractStatement();

  const users = usersQuery.data ?? [];
  const [selectedUserId, setSelectedUserId] = React.useState<number | null>(null);

  React.useEffect(() => {
    const loadedUsers = usersQuery.data ?? [];
    if (selectedUserId !== null || loadedUsers.length === 0) return;
    const sticky = getStickyUserId();
    const fallback = loadedUsers.find((u) => u.is_default)?.id ?? loadedUsers[0]?.id ?? null;
    setSelectedUserId(loadedUsers.some((u) => u.id === sticky) ? sticky : fallback);
  }, [usersQuery.data, selectedUserId]);

  const confirmImport = React.useCallback(
    (item: ImportItem) => {
      if (item.statementId === undefined || item.issuerId === null || item.extractorChoice === null) {
        return;
      }
      const choice = item.extractorChoice;
      extractStatement.mutate(
        {
          statementId: item.statementId,
          body: {
            issuer_id: item.issuerId,
            layout_spec_id: choice.kind === "spec" ? choice.layoutSpecId : null,
            parser_id: choice.kind === "parser" ? choice.parserId : null,
            remember: item.remember,
          },
        },
        {
          onSuccess: (response) => {
            dispatch({ type: "extract_started", clientId: item.clientId, jobId: response.job_id });
          },
          onError: (error) => {
            dispatch({
              type: "extract_failed",
              clientId: item.clientId,
              message: error instanceof Error ? error.message : "Import failed",
            });
          },
        },
      );
    },
    [extractStatement, dispatch],
  );

  const uploadFile = React.useCallback(
    (clientId: string, file: File, userId: number) => {
      uploadStatement.mutate(
        { file, userId },
        {
          onSuccess: (response) => {
            dispatch({
              type: "upload_succeeded",
              clientId,
              statement: response.statement,
              proposal: response.proposal,
            });
            const updatedItem: ImportItem = {
              clientId,
              fileName: file.name,
              userId,
              status: "awaiting_extractor",
              statementId: response.statement.id,
              statement: response.statement,
              proposal: response.proposal,
              issuerId: response.proposal.issuer_id,
              extractorChoice: extractorChoiceFromProposal(response.proposal),
              remember: true,
            };
            if (response.statement.status === "awaiting_extractor" && shouldAutoConfirm(updatedItem)) {
              confirmImport(updatedItem);
            }
          },
          onError: (error) => {
            dispatch({
              type: "upload_failed",
              clientId,
              message: error instanceof Error ? error.message : "Upload failed",
            });
          },
        },
      );
    },
    [uploadStatement, dispatch, confirmImport],
  );

  const handleFiles = React.useCallback(
    (files: File[]) => {
      if (selectedUserId === null) return;
      const clientIds = queueFiles(files, selectedUserId);
      files.forEach((file, index) => {
        const clientId = clientIds[index];
        if (clientId !== undefined) uploadFile(clientId, file, selectedUserId);
      });
    },
    [selectedUserId, queueFiles, uploadFile],
  );

  // Once an item's extract job reaches a terminal state, refresh its statement (and, once
  // parsed, its needs-review count) exactly once per terminal event.
  const refreshedJobIds = React.useRef(new Set<string>());
  const handleJobEvent = React.useCallback(
    (clientId: string, event: JobEvent) => {
      dispatch({ type: "job_event", clientId, event });
      if (event.status !== "done" && event.status !== "error") return;
      const item = items.find((candidate) => candidate.clientId === clientId);
      if (!item || item.statementId === undefined) return;
      const dedupeKey = `${clientId}:${item.jobId ?? ""}`;
      if (refreshedJobIds.current.has(dedupeKey)) return;
      refreshedJobIds.current.add(dedupeKey);
      void refreshAfterJob(clientId, item.statementId, dispatch);
    },
    [items, dispatch],
  );

  if (usersQuery.isLoading) return <LoadingState rows={3} />;
  if (usersQuery.isError) {
    return <ErrorState description="Could not load users." onRetry={() => void usersQuery.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-6 py-2">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Import statements</h1>
        <p className="text-sm text-muted-foreground">
          Drop one or more statement PDFs. Each is matched to an issuer and extractor
          automatically; override either before importing.
        </p>
      </div>

      <label className="flex max-w-xs flex-col gap-1 text-xs font-medium text-muted-foreground">
        Importing for
        <select
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
          value={selectedUserId ?? ""}
          onChange={(event) => {
            const userId = Number(event.target.value);
            setSelectedUserId(userId);
            setStickyUserId(userId);
          }}
        >
          {users.length === 0 ? <option value="">No users yet</option> : null}
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
              {user.is_default ? " (default)" : ""}
            </option>
          ))}
        </select>
      </label>

      <FileDropZone onFiles={handleFiles} disabled={selectedUserId === null} />

      <SummaryBar items={items} />

      {items.length > 0 ? (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <StatementCard
              key={item.clientId}
              item={item}
              onJobEvent={handleJobEvent}
              onConfirm={() => confirmImport(item)}
              onRememberChange={(remember) =>
                dispatch({ type: "remember_toggled", clientId: item.clientId, remember })
              }
              picker={
                <IssuerExtractorPicker
                  item={item}
                  onIssuerChange={(issuerId: number, extractorChoice: ExtractorChoice | null) =>
                    dispatch({
                      type: "issuer_selected",
                      clientId: item.clientId,
                      issuerId,
                      extractorChoice,
                    })
                  }
                  onExtractorChange={(extractorChoice: ExtractorChoice) =>
                    dispatch({ type: "extractor_selected", clientId: item.clientId, extractorChoice })
                  }
                />
              }
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default ImportScreen;

export const screenMeta = { path: "/import", title: "Import" };
