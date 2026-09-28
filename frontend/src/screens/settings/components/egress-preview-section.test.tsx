import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { EgressPreviewSection } from "./egress-preview-section";
import type { Settings } from "../lib/hooks";

const useClassifyPreview = vi.fn();
const useUsersQuery = vi.fn();

vi.mock("../lib/hooks", () => ({
  useClassifyPreview: (...args: unknown[]): unknown => useClassifyPreview(...args),
  useUsersQuery: (): unknown => useUsersQuery(),
}));

const baseSettings: Settings = {
  llm: {
    mode: "remote",
    provider: "anthropic",
    model: "claude",
    api_base: "",
    batch_size: 50,
    timeout_s: 120,
    confidence_threshold: 0.7,
    has_key: true,
  },
  privacy: { store_pdf_copies: true, store_extract_cache: false, pii_terms: [] },
  ingest: { always_confirm_extractor: false, date_format_hints: [], default_currency: "USD" },
  server: { port: 8756 },
};

describe("EgressPreviewSection", () => {
  it("shows a 'nothing is sent' message and skips the payload when mode is 'none'", () => {
    useUsersQuery.mockReturnValue({ data: [] });
    useClassifyPreview.mockReturnValue({ isPending: false, isError: false, isSuccess: false, data: undefined });
    render(<EgressPreviewSection settings={{ ...baseSettings, llm: { ...baseSettings.llm, mode: "none" } }} />);
    expect(screen.getByText(/nothing is ever sent/i)).toBeInTheDocument();
    expect(screen.queryByTestId("egress-preview-csv")).not.toBeInTheDocument();
  });

  it("renders the literal CSV that would be sent, id 1..N, never a database id", () => {
    useUsersQuery.mockReturnValue({ data: [{ id: 1, name: "Alex", is_default: true }] });
    useClassifyPreview.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: [
        { merchant_key: "trader_joes", description_clean: "TRADER JOES #123 SEATTLE WA" },
        { merchant_key: "delta", description_clean: "DELTA AIR LINES" },
      ],
      refetch: vi.fn(),
    });
    render(<EgressPreviewSection settings={baseSettings} />);

    const csv = screen.getByTestId("egress-preview-csv");
    expect(csv.textContent).toBe(
      "id,description\n1,TRADER JOES #123 SEATTLE WA\n2,DELTA AIR LINES",
    );
    expect(screen.getByText("2 row(s)")).toBeInTheDocument();
    expect(screen.getByText("0 redaction hits")).toBeInTheDocument();
  });

  it("flags a normalization bug loudly instead of silently, when a redaction signal survives", () => {
    useUsersQuery.mockReturnValue({ data: [] });
    useClassifyPreview.mockReturnValue({
      isPending: false,
      isError: false,
      isSuccess: true,
      data: [{ merchant_key: "x", description_clean: "CALL 555-123-4567 NOW" }],
      refetch: vi.fn(),
    });
    render(<EgressPreviewSection settings={baseSettings} />);
    expect(screen.getByText(/1 redaction hit/i)).toBeInTheDocument();
    expect(screen.getByText(/this should never be non-zero/i)).toBeInTheDocument();
  });

  it("shows an empty state when there is nothing to classify", () => {
    useUsersQuery.mockReturnValue({ data: [] });
    useClassifyPreview.mockReturnValue({ isPending: false, isError: false, isSuccess: true, data: [] });
    render(<EgressPreviewSection settings={baseSettings} />);
    expect(screen.getByText(/nothing to classify/i)).toBeInTheDocument();
  });
});
