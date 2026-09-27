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
type Account = components["schemas"]["Account"];
type Statement = components["schemas"]["Statement"];

const ISSUERS: Issuer[] = [
  { id: 1, name: "Bank of America", slug: "bank_of_america", match_terms: ["bank of america", "bankofamerica"], default_spec_id: null },
];

const ACCOUNTS: Account[] = [{ id: 10, user_id: 1, issuer_id: 1, account_type: "credit", currency: "USD" }];

const STATEMENTS: Statement[] = [
  {
    id: 100,
    user_id: 1,
    account_id: 10,
    status: "parsed",
    period_start: "2026-01-01",
    period_end: "2026-01-31",
    txn_count: 5,
    reconciliation_delta_minor: 0,
    detect_score: 0.9,
    shape_warnings: null,
    error_detail: null,
    created_at: "2026-02-01T00:00:00Z",
  },
  {
    id: 101,
    user_id: 1,
    account_id: 99,
    status: "parsed",
    period_start: null,
    period_end: null,
    txn_count: null,
    reconciliation_delta_minor: null,
    detect_score: null,
    shape_warnings: null,
    error_detail: null,
    created_at: "2026-02-01T00:00:00Z",
  },
];

function setUpHandlers(overrides: Partial<Record<string, ApiHandler>> = {}) {
  setMockHandlers({
    "GET /issuers": () => ISSUERS,
    "GET /accounts": () => ACCOUNTS,
    "GET /statements": () => STATEMENTS,
    ...overrides,
  });
}

describe("IssuerPanel", () => {
  beforeEach(() => {
    setUpHandlers();
  });

  it("lists issuers with their match terms and attributed statement count", async () => {
    render(<IssuerPanel />, { wrapper: TestProviders });

    expect(await screen.findByText("Bank of America")).toBeInTheDocument();
    expect(screen.getByText("bank of america")).toBeInTheDocument();
    expect(screen.getByText("bankofamerica")).toBeInTheDocument();
    // Only statement 100 (account 10) belongs to issuer 1; statement 101 (account 99) does not.
    await waitFor(() => {
      expect(screen.getByText(/1 past statement currently attributed/)).toBeInTheDocument();
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
