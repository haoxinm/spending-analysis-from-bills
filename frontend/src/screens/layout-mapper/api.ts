import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, throwIfError, type components } from "@/api/client";

/**
 * Screen-local query/mutation hooks for the layout mapper (Phase 3 common brief: "Put
 * screen-specific query hooks inside your screen dir"). Nothing here is shared with another
 * screen.
 */

export function useStatement(statementId: number | null) {
  return useQuery({
    queryKey: ["layout-mapper", "statement", statementId],
    enabled: statementId != null,
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/statements/{statement_id}", {
        params: { path: { statement_id: statementId as number } },
      });
      throwIfError(error);
      return data;
    },
  });
}

/** All statements for `userId`, used to find the account's previous statement for the drift diff
 * (§2d.1) — there is no per-account endpoint, so this is filtered client-side (`drift.ts`). */
export function useStatementsForDrift(userId: number | null) {
  return useQuery({
    queryKey: ["layout-mapper", "statements", userId],
    enabled: userId != null,
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/statements", {
        params: { query: { user_id: userId ?? undefined } },
      });
      throwIfError(error);
      return data ?? [];
    },
  });
}

export function useIssuers() {
  return useQuery({
    queryKey: ["layout-mapper", "issuers"],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/issuers");
      throwIfError(error);
      return data ?? [];
    },
  });
}

export function useLayoutSpecs() {
  return useQuery({
    queryKey: ["layout-mapper", "layout-specs"],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/layout-specs");
      throwIfError(error);
      return data ?? [];
    },
  });
}

function invalidateSpecs(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["layout-mapper", "layout-specs"] });
}

export function useCreateLayoutSpec() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: components["schemas"]["LayoutSpecCreate"]) => {
      const { data, error } = await apiClient.POST("/layout-specs", { body });
      throwIfError(error);
      return data;
    },
    onSuccess: () => invalidateSpecs(queryClient),
  });
}

export function useReviseLayoutSpec() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      specId,
      body,
    }: {
      specId: number;
      body: components["schemas"]["LayoutSpecCreate"];
    }) => {
      const { data, error } = await apiClient.POST("/layout-specs/{spec_id}/revise", {
        params: { path: { spec_id: specId } },
        body,
      });
      throwIfError(error);
      return data;
    },
    onSuccess: () => invalidateSpecs(queryClient),
  });
}

export function useApproveLayoutSpec() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (specId: number) => {
      const { data, error } = await apiClient.POST("/layout-specs/{spec_id}/approve", {
        params: { path: { spec_id: specId } },
      });
      throwIfError(error);
      return data;
    },
    onSuccess: () => invalidateSpecs(queryClient),
  });
}

/** `GET /layout-specs/{id}/export` returns `text/plain` (YAML), not JSON — `openapi-fetch`
 * still parses the response body as text here since the schema has no typed content type. */
export async function exportLayoutSpec(specId: number): Promise<string> {
  const { data, error } = await apiClient.GET("/layout-specs/{spec_id}/export", {
    params: { path: { spec_id: specId } },
    parseAs: "text",
  });
  throwIfError(error);
  return data ?? "";
}

/**
 * Runs a spec against the real statement to get an honest transaction count / reconciliation
 * delta (§2d.2's "live … feedback", degraded — see this WP's report on the missing dry-run
 * endpoint): `POST /statements/{id}/extract` when the statement is still `awaiting_extractor`
 * (nothing parsed yet), otherwise `POST /statements/{id}/reparse`, which "rebuilds that
 * statement's rows" (§3.12) using the given spec. Both **persist**, unlike a true preview.
 */
export function useTestLayoutSpec() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      statementId,
      layoutSpecId,
      issuerId,
      alreadyParsed,
    }: {
      statementId: number;
      layoutSpecId: number;
      issuerId: number;
      alreadyParsed: boolean;
    }) => {
      if (alreadyParsed) {
        const { data, error } = await apiClient.POST("/statements/{statement_id}/reparse", {
          params: { path: { statement_id: statementId } },
          body: { issuer_id: issuerId, layout_spec_id: layoutSpecId, parser_id: null, remember: false },
        });
        throwIfError(error);
        return data;
      }
      const { data, error } = await apiClient.POST("/statements/{statement_id}/extract", {
        params: { path: { statement_id: statementId } },
        body: { issuer_id: issuerId, layout_spec_id: layoutSpecId, remember: false },
      });
      throwIfError(error);
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["layout-mapper", "statement"] });
      void queryClient.invalidateQueries({ queryKey: ["layout-mapper", "statements"] });
    },
  });
}
