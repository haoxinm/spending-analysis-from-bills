import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient, throwIfError, type components } from "@/api/client";

const ROOT_KEY = ["tax"] as const;

export type TaxImportResponse = components["schemas"]["TaxImportResponse"];

export function useTaxYears(userIds: number[] | undefined, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...ROOT_KEY, "years", { userIds }],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/tax/years", {
        params: { query: { user_ids: userIds } },
      });
      throwIfError(error);
      return Array.isArray(data) ? data : [];
    },
  });
}

/** All years' summaries for the selected users (combined when more than one). */
export function useTaxSummary(userIds: number[] | undefined, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...ROOT_KEY, "summary", { userIds }],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/tax/summary", {
        params: { query: { user_ids: userIds, currency: "USD" } },
      });
      throwIfError(error);
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useTaxIncomeByPayer(userIds: number[] | undefined, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...ROOT_KEY, "payers", { userIds }],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/tax/income-by-payer", {
        params: { query: { user_ids: userIds, currency: "USD" } },
      });
      throwIfError(error);
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useTaxDocuments(userId: number | null, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...ROOT_KEY, "documents", { userId }],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/tax/documents", {
        params: { query: { user_id: userId ?? undefined } },
      });
      throwIfError(error);
      return Array.isArray(data) ? data : [];
    },
  });
}

export function useUploadTaxDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      file,
      userId,
      taxYear,
    }: {
      file: File;
      userId: number;
      taxYear?: number;
    }): Promise<TaxImportResponse> => {
      const form = new FormData();
      form.append("file", file);
      form.append("user_id", String(userId));
      if (taxYear !== undefined) form.append("tax_year", String(taxYear));
      const { data, error } = await apiClient.POST("/tax/documents", {
        // A real FormData is passed through by openapi-fetch; the generated type describes the
        // decoded fields (same cast as the Import screen).
        body: form as unknown as components["schemas"]["Body_upload_tax_document_api_tax_documents_post"],
      });
      throwIfError(error);
      if (!data) throw new Error("upload returned no data");
      return data;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ROOT_KEY });
    },
  });
}

export function useDeleteTaxDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await apiClient.DELETE("/tax/documents/{document_id}", {
        params: { path: { document_id: id } },
      });
      throwIfError(error);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROOT_KEY });
    },
  });
}
