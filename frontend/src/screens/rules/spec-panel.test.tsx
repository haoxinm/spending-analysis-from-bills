import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "@/api/client";

import { SpecPanel } from "./spec-panel";
import { type ApiHandler, setMockHandlers, TestProviders } from "./test-utils";

vi.mock("@/api/client", async () => {
  const { dynamicMockFetch } = await import("./test-utils");
  vi.stubGlobal("fetch", dynamicMockFetch);
  return vi.importActual("@/api/client");
});

type LayoutSpec = components["schemas"]["LayoutSpec"];
type Issuer = components["schemas"]["Issuer"];

const ISSUERS: Issuer[] = [
  { id: 1, name: "Bank of America", slug: "bank_of_america", match_terms: [], default_spec_id: null },
];

const SPECS: LayoutSpec[] = [
  { id: 1, name: "boa_credit", version: 1, issuer_id: 1, approved: true, source: "pasted" },
  { id: 2, name: "chase_checking", version: 1, issuer_id: null, approved: false, source: "hand_mapped" },
];

function setUpHandlers(overrides: Partial<Record<string, ApiHandler>> = {}) {
  setMockHandlers({
    "GET /layout-specs": () => SPECS,
    "GET /issuers": () => ISSUERS,
    ...overrides,
  });
}

describe("SpecPanel", () => {
  beforeEach(() => {
    setUpHandlers();
  });

  it("lists specs with version, issuer, approval and source", async () => {
    render(<SpecPanel />, { wrapper: TestProviders });

    expect(await screen.findByText("boa_credit")).toBeInTheDocument();
    expect(screen.getAllByText("v1")).toHaveLength(2);
    expect(screen.getByText("approved")).toBeInTheDocument();
    expect(screen.getByText("pending approval")).toBeInTheDocument();
    expect(screen.getByText(/Issuer: Bank of America/)).toBeInTheDocument();
    expect(screen.getByText(/Issuer: generic/)).toBeInTheDocument();
  });

  it("only offers Approve on a spec that is not yet approved", async () => {
    render(<SpecPanel />, { wrapper: TestProviders });
    await screen.findByText("boa_credit");

    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });

  it("approves a pending spec", async () => {
    let approvedId: number | null = null;
    setUpHandlers({
      "POST /layout-specs/2/approve": () => {
        approvedId = 2;
        return { ...SPECS[1], approved: true };
      },
    });
    const user = userEvent.setup();
    render(<SpecPanel />, { wrapper: TestProviders });
    await screen.findByText("chase_checking");

    await user.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approvedId).toBe(2));
  });

  it("pastes a new spec as v1", async () => {
    let posted: unknown = null;
    setUpHandlers({
      "POST /layout-specs": async (req) => {
        posted = await req.json();
        return { id: 3, name: "wells_credit", version: 1, issuer_id: null, approved: false, source: "pasted" };
      },
    });
    const user = userEvent.setup();
    render(<SpecPanel />, { wrapper: TestProviders });
    await screen.findByText("boa_credit");

    await user.click(screen.getByRole("button", { name: "Paste a spec" }));
    await user.type(screen.getByLabelText("Spec name"), "wells_credit");
    await user.type(screen.getByLabelText("Spec YAML"), "columns: none");
    await user.click(screen.getByRole("button", { name: "Save as v1" }));

    await waitFor(() => {
      expect(posted).toEqual({ name: "wells_credit", spec_yaml: "columns: none", issuer_id: null });
    });
  });

  it("shows an empty state when there are no specs", async () => {
    setUpHandlers({ "GET /layout-specs": () => [] });
    render(<SpecPanel />, { wrapper: TestProviders });

    expect(await screen.findByText("No layout specs yet")).toBeInTheDocument();
  });
});
