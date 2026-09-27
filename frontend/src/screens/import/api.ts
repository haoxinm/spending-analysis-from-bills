import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, throwIfError, type components } from "@/api/client";

/**
 * Import-screen-local API hooks (P3_BRIEF: "Put screen-specific query hooks inside your screen
 * dir"). `useUsers` already exists in `api/hooks.ts` and is reused as-is; everything here is
 * specific to the two-phase import flow (§2f.2) and has no home elsewhere yet.
 */

export function useIssuers() {
  return useQuery({
    queryKey: ["issuers"],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/issuers");
      throwIfError(error);
      return data ?? [];
    },
  });
}

export function useCreateIssuer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: components["schemas"]["IssuerCreate"]) => {
      const { data, error } = await apiClient.POST("/issuers", { body });
      throwIfError(error);
      if (!data) throw new Error("issuer creation returned no data");
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["issuers"] });
    },
  });
}

export function useLayoutSpecs() {
  return useQuery({
    queryKey: ["layout-specs"],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/layout-specs");
      throwIfError(error);
      return data ?? [];
    },
  });
}

export function useUploadStatement() {
  return useMutation({
    mutationFn: async ({ file, userId }: { file: File; userId: number }) => {
      const form = new FormData();
      form.append("file", file);
      form.append("user_id", String(userId));
      const { data, error } = await apiClient.POST("/statements", {
        // openapi-fetch's default body serializer passes a `FormData` body through unchanged
        // (letting the browser set the multipart boundary) instead of `JSON.stringify`-ing it;
        // the generated `Body_upload_statement_api_statements_post` type describes the decoded
        // *fields*, not the wire body, so a real `FormData` is cast to it here.
        body: form as unknown as components["schemas"]["Body_upload_statement_api_statements_post"],
      });
      throwIfError(error);
      if (!data) throw new Error("upload returned no data");
      return data;
    },
  });
}

export function useExtractStatement() {
  return useMutation({
    mutationFn: async ({
      statementId,
      body,
    }: {
      statementId: number;
      body: components["schemas"]["ExtractRequest"];
    }) => {
      const { data, error } = await apiClient.POST("/statements/{statement_id}/extract", {
        params: { path: { statement_id: statementId } },
        body,
      });
      throwIfError(error);
      if (!data) throw new Error("extract returned no data");
      return data;
    },
  });
}

export async function fetchStatement(
  statementId: number,
): Promise<components["schemas"]["Statement"] | null> {
  const { data, error } = await apiClient.GET("/statements/{statement_id}", {
    params: { path: { statement_id: statementId } },
  });
  if (error) return null;
  return data ?? null;
}

export async function fetchJob(jobId: string): Promise<components["schemas"]["Job"] | null> {
  const { data, error } = await apiClient.GET("/jobs/{job_id}", {
    params: { path: { job_id: jobId } },
  });
  if (error) return null;
  return data ?? null;
}

/**
 * Best-effort count of this statement's transactions still flagged `needs_review` (§3.12's
 * `Transaction.needs_review`), for the summary line's "N need review" clause.
 *
 * Known limitation: `GET /api/transactions` has no `statement_id` filter and `GET /api/jobs/{id}`
 * never surfaces the chained classify job's id or its `needs_review` count (§3.12a
 * `ClassifyResult`, discarded by `_job_response`) — the import job's own SSE stream only covers
 * parsing, not the classify job it enqueues afterwards. This scopes by `account_id` and the
 * statement's own period instead, which is exact for a statement imported into an otherwise-idle
 * account and only ever over-counts when another import's rows share the same account and dates.
 * A cleaner fix needs a backend change (a `statement_id` filter, or the classify job's id and
 * count surfaced through the API) — flagged in this WP's report rather than filed as a blocking
 * contract change request, since this workaround needs no owned-elsewhere file to change.
 */
export async function fetchNeedsReviewCount(params: {
  accountId: number;
  periodStart: string | null;
  periodEnd: string | null;
  atLeast: number;
}): Promise<number | undefined> {
  if (!params.periodStart || !params.periodEnd) return undefined;
  const { data, error } = await apiClient.GET("/transactions", {
    params: {
      query: {
        account_ids: [params.accountId],
        date_from: params.periodStart,
        date_to: params.periodEnd,
        page: 1,
        page_size: Math.max(params.atLeast, 1),
        include_non_spend: true,
      },
    },
  });
  if (error || !data) return undefined;
  return data.items.filter((t) => t.needs_review).length;
}
