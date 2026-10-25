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

// ---- Manual overrides ------------------------------------------------------------------------

type Schemas = components["schemas"];
export type TaxFormCreate = Schemas["TaxFormCreate"];
export type TaxFormPatch = Schemas["TaxFormPatch"];
export type IncomeItemIn = Schemas["IncomeItemIn"];
export type IncomeItemPatch = Schemas["IncomeItemPatch"];
export type TaxItemIn = Schemas["TaxItemIn"];
export type TaxItemPatch = Schemas["TaxItemPatch"];

export function useTaxDocument(id: number, enabled = true) {
  return useQuery({
    enabled,
    queryKey: [...ROOT_KEY, "document", id],
    queryFn: async () => {
      const { data, error } = await apiClient.GET("/tax/documents/{document_id}", {
        params: { path: { document_id: id } },
      });
      throwIfError(error);
      if (!data) throw new Error("document not found");
      return data;
    },
  });
}

/** A mutation that refreshes every tax query (summary, years, payers, documents, details). */
function useTaxMutation<V, R>(fn: (v: V) => Promise<R>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ROOT_KEY });
    },
  });
}

function need<T>(data: T | undefined): T {
  if (data === undefined) throw new Error("The server returned no data.");
  return data;
}

export function useCreateManualDocument() {
  return useTaxMutation(
    async (body: { user_id: number; tax_year: number; original_name?: string | null }) => {
      const { data, error } = await apiClient.POST("/tax/documents/manual", { body });
      throwIfError(error);
      return need(data);
    },
  );
}

export function useCreateTaxForm() {
  return useTaxMutation(async ({ documentId, body }: { documentId: number; body: TaxFormCreate }) => {
    const { data, error } = await apiClient.POST("/tax/documents/{document_id}/forms", {
      params: { path: { document_id: documentId } },
      body,
    });
    throwIfError(error);
    return need(data);
  });
}

export function useUpdateTaxForm() {
  return useTaxMutation(async ({ formId, patch }: { formId: number; patch: TaxFormPatch }) => {
    const { data, error } = await apiClient.PATCH("/tax/forms/{form_id}", {
      params: { path: { form_id: formId } },
      body: patch,
    });
    throwIfError(error);
    return need(data);
  });
}

export function useDeleteTaxForm() {
  return useTaxMutation(async (formId: number) => {
    const { error } = await apiClient.DELETE("/tax/forms/{form_id}", {
      params: { path: { form_id: formId } },
    });
    throwIfError(error);
  });
}

export function useConfirmTaxForm() {
  return useTaxMutation(async (formId: number) => {
    const { data, error } = await apiClient.POST("/tax/forms/{form_id}/confirm", {
      params: { path: { form_id: formId } },
    });
    throwIfError(error);
    return need(data);
  });
}

export function useCreateIncomeItem() {
  return useTaxMutation(async ({ formId, body }: { formId: number; body: IncomeItemIn }) => {
    const { data, error } = await apiClient.POST("/tax/forms/{form_id}/income-items", {
      params: { path: { form_id: formId } },
      body,
    });
    throwIfError(error);
    return need(data);
  });
}

export function useUpdateIncomeItem() {
  return useTaxMutation(async ({ id, patch }: { id: number; patch: IncomeItemPatch }) => {
    const { data, error } = await apiClient.PATCH("/tax/income-items/{item_id}", {
      params: { path: { item_id: id } },
      body: patch,
    });
    throwIfError(error);
    return need(data);
  });
}

export function useDeleteIncomeItem() {
  return useTaxMutation(async (id: number) => {
    const { error } = await apiClient.DELETE("/tax/income-items/{item_id}", {
      params: { path: { item_id: id } },
    });
    throwIfError(error);
  });
}

export function useCreateTaxItem() {
  return useTaxMutation(async ({ formId, body }: { formId: number; body: TaxItemIn }) => {
    const { data, error } = await apiClient.POST("/tax/forms/{form_id}/tax-items", {
      params: { path: { form_id: formId } },
      body,
    });
    throwIfError(error);
    return need(data);
  });
}

export function useUpdateTaxItem() {
  return useTaxMutation(async ({ id, patch }: { id: number; patch: TaxItemPatch }) => {
    const { data, error } = await apiClient.PATCH("/tax/tax-items/{item_id}", {
      params: { path: { item_id: id } },
      body: patch,
    });
    throwIfError(error);
    return need(data);
  });
}

export function useDeleteTaxItem() {
  return useTaxMutation(async (id: number) => {
    const { error } = await apiClient.DELETE("/tax/tax-items/{item_id}", {
      params: { path: { item_id: id } },
    });
    throwIfError(error);
  });
}
