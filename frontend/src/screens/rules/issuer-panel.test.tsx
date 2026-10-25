import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "@/api/client";

import { IssuerPanel } from "./issuer-panel";
import { type ApiHandler, setMockHandlers, TestProviders } from "./test-utils";

vi.mock("@/api/client", async () => {
  const { dynamicMockFetch } = await import("./test-utils");
  vi.stubGlobal("fetch", dynamicMockFetch);
  return vi.importActual("@/api/client");
});

type Issuer = components["schemas"]["Issuer"];
type IssuerMatchPreviewRow = components["schemas"]["IssuerMatchPreviewRow"];

const ISSUERS: Issuer[] = [
  { id: 1, name: "Bank of America", slug: "bank_of_america", match_terms: ["bank of america", "bankofamerica"], default_spec_id: null },
];

const PREVIEW_MATCHES: IssuerMatchPreviewRow[] = [
  { statement_id: 100, original_name: "BANK OF AMERICA", status: "parsed", period_start: "2026-01-01", period_end: "2026-01-31" },
];

function setUpHandlers(overrides: Partial<Record<string, ApiHandler>> = {}) {
  setMockHandlers({
    "GET /issuers": () => ISSUERS,
    "POST /preview-match": () => PREVIEW_MATCHES,
    ...overrides,
  });
}

describe("IssuerPanel", () => {
  beforeEach(() => {
    setUpHandlers();
  });

  it("lists issuers with their match terms and a live match count", async () => {
    render(<IssuerPanel />, { wrapper: TestProviders });

    expect(await screen.findByText("Bank of America")).toBeInTheDocument();
    expect(screen.getByText("bank of america")).toBeInTheDocument();
    expect(screen.getByText("bankofamerica")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Matches 1 past statement/)).toBeInTheDocument();
    });
  });

  it("creates a new issuer from name + comma-separated terms", async () => {
    let created: unknown = null;
    setUpHandlers({
      "POST /issuers": async (req) => {
        created = await req.json();
        return { id: 2, name: "Chase", slug: "chase", match_terms: ["chase", "jpmorgan"], default_spec_id: null };
      },
    });
    const user = userEvent.setup();
    render(<IssuerPanel />, { wrapper: TestProviders });
    await screen.findByText("Bank of America");

    await user.type(screen.getByLabelText("New issuer name"), "Chase");
    await user.type(screen.getByLabelText("New issuer match terms"), "chase, jpmorgan");
    await user.click(screen.getByRole("button", { name: "Add issuer" }));

    await waitFor(() => {
      expect(created).toEqual({ name: "Chase", match_terms: ["chase", "jpmorgan"] });
    });
  });

  it("shows an empty state when there are no issuers", async () => {
    setUpHandlers({ "GET /issuers": () => [] });
    render(<IssuerPanel />, { wrapper: TestProviders });

    expect(await screen.findByText("No issuers yet")).toBeInTheDocument();
  });
});
