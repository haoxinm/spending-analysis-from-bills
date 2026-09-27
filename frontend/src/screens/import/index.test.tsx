import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  close() {
    // no-op: nothing to assert on in these tests.
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** `openapi-fetch` always calls `fetch(request: Request, ...)`, never a bare URL string, so a
 * mock keyed on request shape reads `.url`/`.method` off the `Request` object itself. */
function describeRequest(input: RequestInfo | URL): { url: string; method: string } {
  if (input instanceof Request) return { url: input.url, method: input.method };
  return { url: input.toString(), method: "GET" };
}

const USER = { id: 1, name: "Alex", is_default: true };
const ISSUER = { id: 3, name: "Chase", slug: "chase", match_terms: ["chase"], default_spec_id: null };
const STATEMENT_AWAITING = {
  id: 7,
  user_id: 1,
  account_id: null,
  status: "awaiting_extractor" as const,
  period_start: null,
  period_end: null,
  txn_count: null,
  reconciliation_delta_minor: null,
  detect_score: 0.92,
  shape_warnings: null,
  error_detail: null,
  created_at: "2024-02-01T00:00:00Z",
};
const STATEMENT_PARSED = {
  ...STATEMENT_AWAITING,
  status: "parsed" as const,
  account_id: 5,
  period_start: "2024-01-01",
  period_end: "2024-01-31",
  txn_count: 40,
  reconciliation_delta_minor: 0,
};

/**
 * `apiClient` (`@/api/client`) captures `globalThis.fetch` once, at module load, exactly like
 * `client.test.ts` documents — so each test resets the module registry and stubs `fetch` *before*
 * dynamically importing the screen, rather than importing it (and its transitive `apiClient`)
 * once at this file's top, which would freeze in whichever `fetch` happened to be global first.
 */
async function renderScreen(fetchMock: typeof fetch) {
  vi.resetModules();
  vi.stubGlobal("fetch", fetchMock);
  const { default: ImportScreen } = await import("./index");
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <ImportScreen />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("screenMeta", () => {
  it("matches the P3 screen contract", async () => {
    vi.resetModules();
    const { screenMeta } = await import("./index");
    expect(screenMeta).toEqual({ path: "/import", title: "Import" });
  });
});

describe("ImportScreen", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("defaults the user selector to the default user and lets the user drop a file through to a confident, pre-selected proposal", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const { url, method } = describeRequest(input);
      if (url.includes("/api/users")) return Promise.resolve(jsonResponse([USER]));
      if (url.includes("/api/issuers")) return Promise.resolve(jsonResponse([ISSUER]));
      if (url.includes("/api/layout-specs")) return Promise.resolve(jsonResponse([]));
      if (url.includes("/api/statements") && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              statement: STATEMENT_AWAITING,
              proposal: {
                issuer_id: 3,
                parser_id: "layout_a_credit",
                layout_spec_id: null,
                confidence: 0.92,
                auto_confirmed: false,
              },
            },
            201,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ detail: `unhandled request: ${method} ${url}` }, 404));
    });
    await renderScreen(fetchMock);

    await waitFor(() => expect(screen.getByText("Alex (default)")).toBeInTheDocument());

    const pdf = new File(["%PDF-1.4"], "chase.pdf", { type: "application/pdf" });
    const input = screen.getByLabelText("Choose statement PDFs");
    await userEvent.upload(input, pdf);

    await waitFor(() => expect(screen.getByText("chase.pdf")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("Ready to import")).toBeInTheDocument());
    expect(screen.getByText(/Detected confidence: 92%/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import" })).toBeEnabled();
  });

  it("takes a no_text_layer upload straight to that failure message, with no extractor step", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const { url, method } = describeRequest(input);
      if (url.includes("/api/users")) return Promise.resolve(jsonResponse([USER]));
      if (url.includes("/api/issuers")) return Promise.resolve(jsonResponse([ISSUER]));
      if (url.includes("/api/layout-specs")) return Promise.resolve(jsonResponse([]));
      if (url.includes("/api/statements") && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              statement: {
                ...STATEMENT_AWAITING,
                status: "no_text_layer",
                error_detail: "Can't read this PDF — it looks like a scan or an image.",
              },
              proposal: {
                issuer_id: null,
                parser_id: null,
                layout_spec_id: null,
                confidence: 0,
                auto_confirmed: false,
              },
            },
            201,
          ),
        );
      }
      return Promise.resolve(jsonResponse({ detail: `unhandled request: ${method} ${url}` }, 404));
    });
    await renderScreen(fetchMock);
    await waitFor(() => expect(screen.getByText("Alex (default)")).toBeInTheDocument());

    const pdf = new File(["%PDF-1.4"], "scanned.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Choose statement PDFs"), pdf);

    await waitFor(() =>
      expect(
        screen.getByText("Can't read this PDF — it looks like a scan or an image."),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Can't read this PDF")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Import" })).not.toBeInTheDocument();
  });

  it("shows the running summary once a statement finishes parsing", async () => {
    let extractCalled = false;
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const { url, method } = describeRequest(input);
      if (url.includes("/api/users")) return Promise.resolve(jsonResponse([USER]));
      if (url.includes("/api/issuers")) return Promise.resolve(jsonResponse([ISSUER]));
      if (url.includes("/api/layout-specs")) return Promise.resolve(jsonResponse([]));
      if (url.includes("/api/statements/7/extract") && method === "POST") {
        extractCalled = true;
        return Promise.resolve(jsonResponse({ job_id: "job-1" }, 202));
      }
      if (url.includes("/api/statements/7") && method === "GET") {
        return Promise.resolve(jsonResponse(STATEMENT_PARSED));
      }
      if (url.includes("/api/statements") && method === "POST") {
        return Promise.resolve(
          jsonResponse(
            {
              statement: STATEMENT_AWAITING,
              proposal: {
                issuer_id: 3,
                parser_id: "layout_a_credit",
                layout_spec_id: null,
                confidence: 0.92,
                auto_confirmed: false,
              },
            },
            201,
          ),
        );
      }
      if (url.includes("/api/transactions")) {
        return Promise.resolve(jsonResponse({ items: [], total: 0 }));
      }
      return Promise.resolve(jsonResponse({ detail: `unhandled request: ${method} ${url}` }, 404));
    });
    await renderScreen(fetchMock);
    await waitFor(() => expect(screen.getByText("Alex (default)")).toBeInTheDocument());

    const pdf = new File(["%PDF-1.4"], "chase.pdf", { type: "application/pdf" });
    await userEvent.upload(screen.getByLabelText("Choose statement PDFs"), pdf);
    await waitFor(() => expect(screen.getByRole("button", { name: "Import" })).toBeEnabled());

    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(extractCalled).toBe(true);
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));

    const source = MockEventSource.instances[0];
    if (!source) throw new Error("expected an EventSource instance");
    source.onmessage?.({ data: JSON.stringify({ status: "done", progress: 1 }) });

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("1 statement imported · 40 new transactions"),
    );
  });
});
