import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiClient } from "@/api/client";
import { ToastContextProvider } from "@/components/ui/toast-provider";

import TaxScreen, { screenMeta } from "./index";
import { PAYERS, USERS, document, summary } from "./test-fixtures";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, apiClient: { GET: vi.fn(), POST: vi.fn(), DELETE: vi.fn() } };
});

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/tax"]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ToastContextProvider>{children}</ToastContextProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const get = apiClient.GET as unknown as ReturnType<typeof vi.fn>;
const post = apiClient.POST as unknown as ReturnType<typeof vi.fn>;
const del = apiClient.DELETE as unknown as ReturnType<typeof vi.fn>;

function mockGet(responses: Record<string, unknown>) {
  get.mockImplementation((path: string) =>
    Promise.resolve({ data: responses[path] ?? [], error: undefined }),
  );
}

const FULL = {
  "/users": USERS,
  "/tax/years": [2024, 2023],
  "/tax/summary": [summary(), summary({ tax_year: 2023, total_income_minor: 9000000 })],
  "/tax/income-by-payer": PAYERS,
  "/tax/documents": [
    document(),
    document({ id: 2, original_name: "scan.pdf", status: "unsupported", form_types: [], tax_year: null, error_detail: "Not a recognised tax form." }),
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  get.mockReset();
  post.mockReset();
  del.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("TaxScreen", () => {
  it("exposes its route metadata", () => {
    expect(screenMeta).toEqual({ path: "/tax", title: "Income & Tax" });
  });

  it("labels the tax-year override input by its visible text only", async () => {
    mockGet({ "/users": [USERS[0]] });
    render(<TaxScreen />, { wrapper });
    const input = await screen.findByLabelText(/Tax year \(only if a form/);
    expect(input).not.toHaveAttribute("aria-label");
  });

  it("shows the empty state and the upload zone with a privacy note", async () => {
    mockGet({ "/users": [USERS[0]] });
    render(<TaxScreen />, { wrapper });
    expect(await screen.findByText("Import a W-2, 1099 or 1040 to see income and tax")).toBeInTheDocument();
    expect(screen.getByLabelText("Choose tax form PDFs")).toBeInTheDocument();
    expect(screen.getByTestId("tax-privacy-note")).toHaveTextContent(/last 4 digits/);
  });

  it("renders summary cards, breakdowns, payers and the year-over-year chart", async () => {
    mockGet(FULL);
    render(<TaxScreen />, { wrapper });
    const cards = await screen.findByTestId("tax-summary-cards");
    expect(within(cards).getByText("$112,882.60")).toBeInTheDocument();
    expect(within(screen.getByTestId("effective-rate-card")).getByText("13.19%")).toBeInTheDocument();
    expect(within(screen.getByTestId("all-in-rate-card")).getByText("25.37%")).toBeInTheDocument();
    expect(screen.getByTestId("basis-banner")).toHaveTextContent(/differ from the 1040/);
    // Memo lines are shown but the total stays at the non-memo sum.
    expect(screen.getByTestId("income-memo")).toHaveTextContent(/Qualified dividends/);
    expect(screen.getAllByText("estimate")).toHaveLength(2);
    expect(screen.getByText(/not reported/)).toBeInTheDocument(); // NIIT
    expect(within(screen.getByTestId("income-by-payer")).getByText("Pinecrest Logistics LLC")).toBeInTheDocument();
    expect(screen.getByTestId("year-over-year")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "2023" })).toBeInTheDocument();
  });

  it("hides year-over-year with a single year and shows no banner for the return basis", async () => {
    mockGet({
      ...FULL,
      "/tax/years": [2024],
      "/tax/summary": [summary({ income_basis: "return", warnings: [] })],
    });
    render(<TaxScreen />, { wrapper });
    await screen.findByTestId("tax-summary-cards");
    expect(screen.queryByTestId("year-over-year")).not.toBeInTheDocument();
    expect(screen.queryByTestId("basis-banner")).not.toBeInTheDocument();
  });

  it("shows the mixed basis banner", async () => {
    mockGet({ ...FULL, "/tax/summary": [summary({ income_basis: "mixed", warnings: [] })] });
    render(<TaxScreen />, { wrapper });
    await screen.findByTestId("tax-summary-cards");
    expect(screen.getByTestId("basis-banner")).toHaveTextContent(/Form 1040/);
  });

  it("switches year", async () => {
    mockGet(FULL);
    render(<TaxScreen />, { wrapper });
    await screen.findByTestId("tax-summary-cards");
    await userEvent.click(screen.getByRole("radio", { name: "2023" }));
    expect(within(screen.getByTestId("tax-summary-cards")).getByText("$90,000.00")).toBeInTheDocument();
  });

  it("never renders SSN-shaped text", async () => {
    mockGet(FULL);
    const { container } = render(<TaxScreen />, { wrapper });
    await screen.findByTestId("tax-summary-cards");
    expect(container.textContent).not.toMatch(/\d{3}-\d{2}-\d{4}/);
  });

  it("filters by the selected user chip", async () => {
    mockGet(FULL);
    render(<TaxScreen />, { wrapper });
    await screen.findByTestId("tax-summary-cards");
    await userEvent.click(screen.getByRole("radio", { name: "Sam" }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(
        "/tax/summary",
        expect.objectContaining({ params: { query: { user_ids: [2], currency: "USD" } } }),
      ),
    );
  });

  it("requires a confirm before deleting a document", async () => {
    mockGet(FULL);
    del.mockResolvedValue({ error: undefined });
    render(<TaxScreen />, { wrapper });
    await userEvent.click(await screen.findByRole("button", { name: "Delete tax_w2_normal.pdf" }));
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    await waitFor(() =>
      expect(del).toHaveBeenCalledWith("/tax/documents/{document_id}", { params: { path: { document_id: 1 } } }),
    );
  });

  it("lists badges and errors for documents and asks for a user when All is selected", async () => {
    mockGet(FULL);
    render(<TaxScreen />, { wrapper });
    const docs = await screen.findAllByTestId("tax-document");
    expect(docs).toHaveLength(2);
    expect(within(docs[0]!).getByText("W-2")).toBeInTheDocument();
    expect(within(docs[1]!).getByText("Unsupported")).toBeInTheDocument();
    expect(within(docs[1]!).getByText("Not a recognised tax form.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Upload for user" })).toBeInTheDocument();
  });

  it("uploads a PDF for the chosen user and reports the outcome", async () => {
    mockGet(FULL);
    post.mockResolvedValue({
      data: {
        document: document(),
        status: "duplicate",
        inserted_forms: 0,
        skipped_duplicate_forms: 1,
        income_item_count: 0,
        tax_item_count: 0,
        warnings: [],
        error: null,
      },
      error: undefined,
    });
    render(<TaxScreen />, { wrapper });
    await screen.findByTestId("tax-summary-cards");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Upload for user" }), "2");
    const file = new File(["%PDF-1.4"], "w2.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Choose tax form PDFs"), file);
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [path, init] = post.mock.calls[0] as [string, { body: FormData }];
    expect(path).toBe("/tax/documents");
    expect(init.body.get("user_id")).toBe("2");
    expect(await screen.findByTestId("upload-outcomes")).toHaveTextContent(/Already imported/);
  });
});
