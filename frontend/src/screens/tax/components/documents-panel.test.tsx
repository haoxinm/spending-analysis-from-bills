import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/api/client";
import { ToastContextProvider } from "@/components/ui/toast-provider";
import { Toaster } from "@/components/ui/toaster";

import { USERS, document, formDetail } from "../test-fixtures";
import { DocumentsPanel } from "./documents-panel";

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn(), PATCH: vi.fn() } };
});

const get = apiClient.GET as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.POST as unknown as ReturnType<typeof vi.fn>;
const patch = apiClient.PATCH as unknown as ReturnType<typeof vi.fn>;
const del = apiClient.DELETE as unknown as ReturnType<typeof vi.fn>;

let client: QueryClient;
function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ToastContextProvider>
        {children}
        <Toaster />
      </ToastContextProvider>
    </QueryClientProvider>
  );
}

let detailForms = [formDetail()];
const ok = (data: unknown) => Promise.resolve({ data, error: undefined });

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const m of [get, post, patch, del]) m.mockReset();
  detailForms = [formDetail()];
  get.mockImplementation((path: string) =>
    path === "/tax/documents/{document_id}" ? ok({ ...document(), forms: detailForms }) : ok([]),
  );
  patch.mockImplementation(() => ok({}));
  post.mockImplementation(() => ok({}));
  del.mockImplementation(() => ok(undefined));
});

function renderPanel(docs = [document()]) {
  return render(<DocumentsPanel documents={docs} users={USERS} selectedUserId={1} />, { wrapper: Wrapper });
}

async function openFirst(name = "tax_w2_normal.pdf") {
  await userEvent.click(screen.getByRole("button", { name: `Review figures for ${name}` }));
  return screen.findByTestId("document-detail");
}

describe("review figures disclosure", () => {
  it("expands lazily and shows forms, items and the provenance badge", async () => {
    renderPanel();
    const toggle = screen.getByRole("button", { name: /Review figures for/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(get).not.toHaveBeenCalled();
    const detail = await openFirst();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(detail).getByText("Parsed")).toBeInTheDocument();
    expect(within(detail).getByRole("group", { name: "Income item: Wages and salary box 1" })).toBeInTheDocument();
    expect(within(detail).getByLabelText("Payer name")).toHaveValue("Pinecrest Logistics LLC");
  });

  it("edits an amount in dollars and sends integer cents", async () => {
    renderPanel();
    const detail = await openFirst();
    const row = within(detail).getByRole("group", { name: /Income item: Wages and salary/ });
    const amount = within(row).getByLabelText("Amount ($)");
    expect(amount).toHaveValue("85432.10");
    expect(within(row).queryByRole("button", { name: "Save item" })).not.toBeInTheDocument();
    await userEvent.clear(amount);
    await userEvent.type(amount, "$90,000.5{enter}");
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/tax/income-items/{item_id}", {
        params: { path: { item_id: 100 } },
        body: expect.objectContaining({ amount_minor: 9000050, category: "salary_wages" }) as unknown,
      }),
    );
  });

  it("refuses a bad amount without calling the server", async () => {
    renderPanel();
    const detail = await openFirst();
    const row = within(detail).getByRole("group", { name: /Income item: Wages and salary/ });
    const amount = within(row).getByLabelText("Amount ($)");
    await userEvent.clear(amount);
    await userEvent.type(amount, "12abc");
    await userEvent.click(within(row).getByRole("button", { name: "Save item" }));
    expect(await within(row).findByText("Enter a valid dollar amount")).toBeInTheDocument();
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(patch).not.toHaveBeenCalled();
  });

  it("rejects a negative tax amount", async () => {
    renderPanel();
    const detail = await openFirst();
    const row = within(detail).getByRole("group", { name: /Tax item: Federal income tax withheld/ });
    const amount = within(row).getByLabelText("Amount ($)");
    await userEvent.clear(amount);
    await userEvent.type(amount, "-5");
    expect(await within(row).findByText("Amount cannot be negative")).toBeInTheDocument();
  });

  it("adds an income item", async () => {
    renderPanel();
    const detail = await openFirst();
    await userEvent.click(within(detail).getByRole("button", { name: "Add income item" }));
    const row = within(detail).getByRole("group", { name: "New income item" });
    await userEvent.selectOptions(within(row).getByLabelText("Category"), "interest");
    await userEvent.type(within(row).getByLabelText("Box"), "1");
    await userEvent.type(within(row).getByLabelText("Amount ($)"), "25.5");
    await userEvent.click(within(row).getByRole("button", { name: "Add income item" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/tax/forms/{form_id}/income-items", {
        params: { path: { form_id: 10 } },
        body: { category: "interest", amount_minor: 2550, box: "1", label: null, is_memo: false },
      }),
    );
  });

  it("deletes a tax item", async () => {
    renderPanel();
    const detail = await openFirst();
    const row = within(detail).getByRole("group", { name: /Tax item: Federal income tax withheld/ });
    await userEvent.click(within(row).getByRole("button", { name: "Delete item" }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/tax/tax-items/{item_id}", { params: { path: { item_id: 200 } } }),
    );
  });

  it("edits the payer name and validates last 4", async () => {
    renderPanel();
    const detail = await openFirst();
    const last4 = within(detail).getByLabelText("Payer ID last 4");
    await userEvent.clear(last4);
    await userEvent.type(last4, "12");
    await userEvent.click(within(detail).getByRole("button", { name: "Save form" }));
    expect(await within(detail).findByText("Enter exactly 4 digits")).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
    await userEvent.clear(last4);
    await userEvent.type(last4, "9876");
    const payer = within(detail).getByLabelText("Payer name");
    await userEvent.clear(payer);
    await userEvent.type(payer, "New Corp");
    await userEvent.click(within(detail).getByRole("button", { name: "Save form" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith("/tax/forms/{form_id}", {
        params: { path: { form_id: 10 } },
        body: { payer_name: "New Corp", payer_tin_last4: "9876" },
      }),
    );
  });

  it("confirms LLM values that need review", async () => {
    detailForms = [formDetail({ extraction_method: "llm", needs_review: true })];
    renderPanel();
    const detail = await openFirst();
    expect(within(detail).getByText("Read by LLM — needs review")).toBeInTheDocument();
    await userEvent.click(within(detail).getByRole("button", { name: "Confirm values" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/tax/forms/{form_id}/confirm", { params: { path: { form_id: 10 } } }),
    );
  });

  it("asks before deleting a form", async () => {
    renderPanel();
    const detail = await openFirst();
    await userEvent.click(within(detail).getByRole("button", { name: "Delete form" }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(within(detail).getByRole("button", { name: "Confirm delete form" }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/tax/forms/{form_id}", { params: { path: { form_id: 10 } } }),
    );
  });

  it("shows a toast with the server's 422 message", async () => {
    patch.mockImplementation(() =>
      Promise.resolve({
        data: undefined,
        error: { detail: [{ msg: "payer name looks like an SSN" }] },
        response: { status: 422 },
      }),
    );
    renderPanel();
    const detail = await openFirst();
    const payer = within(detail).getByLabelText("Payer name");
    await userEvent.clear(payer);
    await userEvent.type(payer, "123-45-6789");
    await userEvent.click(within(detail).getByRole("button", { name: "Save form" }));
    expect(await screen.findByText("Could not save form")).toBeInTheDocument();
    expect(screen.getByText("payer name looks like an SSN")).toBeInTheDocument();
  });
});

describe("manual entry", () => {
  const failed = document({ id: 5, original_name: "scan.pdf", status: "unsupported", form_types: [], tax_year: 2024, error_detail: "Not a tax form" });

  it("adds a form to a failed document via Add figures manually", async () => {
    detailForms = [];
    renderPanel([failed]);
    await userEvent.click(screen.getByRole("button", { name: "Add figures manually" }));
    const form = await screen.findByRole("form", { name: "Add form" });
    expect(screen.getByText("No figures were read. Add them manually.")).toBeInTheDocument();
    await userEvent.selectOptions(within(form).getByLabelText("Form type"), "1099-int");
    await userEvent.type(within(form).getByLabelText("Payer name"), "Harbor Bank");
    await userEvent.click(within(form).getByRole("button", { name: "Add form" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/tax/documents/{document_id}/forms", {
        params: { path: { document_id: 5 } },
        body: expect.objectContaining({ form_type: "1099-int", payer_name: "Harbor Bank", tax_year: 2024 }) as unknown,
      }),
    );
  });

  it("validates the add-form fields", async () => {
    detailForms = [];
    renderPanel([failed]);
    await userEvent.click(screen.getByRole("button", { name: "Add figures manually" }));
    const form = await screen.findByRole("form", { name: "Add form" });
    await userEvent.type(within(form).getByLabelText("Payer ID last 4"), "123");
    await userEvent.click(within(form).getByRole("button", { name: "Add form" }));
    expect(await within(form).findByText("Enter exactly 4 digits")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("creates a manual document without a PDF and opens the editor", async () => {
    detailForms = [];
    post.mockImplementation(() => ok(document({ id: 9, original_name: "Manual entry", form_types: [] })));
    const docs = [document({ id: 9, original_name: "Manual entry", form_types: [] })];
    const { rerender } = renderPanel([]);
    await userEvent.click(screen.getByRole("button", { name: "Enter figures without a PDF" }));
    expect(await screen.findByText("Enter the tax year first")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Tax year \(only/), "2024");
    await userEvent.click(screen.getByRole("button", { name: "Enter figures without a PDF" }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/tax/documents/manual", { body: { user_id: 1, tax_year: 2024 } }),
    );
    rerender(<DocumentsPanel documents={docs} users={USERS} selectedUserId={1} />);
    expect(await screen.findByRole("form", { name: "Add form" })).toBeInTheDocument();
  });
});

describe("upload outcome", () => {
  it("lists skipped-from files and warnings, and offers manual entry for failures", async () => {
    post.mockImplementation(() =>
      ok({
        document: document({ id: 7 }),
        status: "parsed",
        inserted_forms: 1,
        skipped_duplicate_forms: 1,
        skipped_from: [{ document_id: 1, original_name: "x.pdf", form_type: "w2" }],
        income_item_count: 1,
        tax_item_count: 0,
        warnings: ["Payer name was inferred from the page header."],
        error: null,
      }),
    );
    renderPanel();
    const input = screen.getByLabelText("Choose tax form PDFs");
    await userEvent.upload(input, new File(["x"], "new.pdf", { type: "application/pdf" }));
    const list = await screen.findByTestId("upload-outcomes");
    expect(within(list).getByText("Imported 1 form.", { exact: false })).toBeInTheDocument();
    expect(within(list).getByText('1 form was already imported from "x.pdf" and was skipped.')).toBeInTheDocument();
    expect(within(list).getByText("Payer name was inferred from the page header.")).toBeInTheDocument();
  });
});
