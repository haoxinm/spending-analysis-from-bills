import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PrivacySection } from "./privacy-section";
import type { Settings } from "../lib/hooks";

const baseSettings: Settings = {
  llm: {
    mode: "none",
    provider: "",
    model: "",
    api_base: "",
    batch_size: 50,
    timeout_s: 120,
    confidence_threshold: 0.7,
    has_key: false,
  },
  privacy: { store_pdf_copies: true, store_extract_cache: false, pii_terms: ["Alex"] },
  ingest: { always_confirm_extractor: false, date_format_hints: [], default_currency: "USD" },
  server: { port: 8756 },
};

describe("PrivacySection", () => {
  it("shows existing toggles and PII terms", () => {
    render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
    expect(screen.getByRole("checkbox", { name: /keep a copy/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /cache extracted page text/i })).not.toBeChecked();
    expect(screen.getByText("Alex")).toBeInTheDocument();
  });

  it("disables Save until something changes", async () => {
    const user = userEvent.setup();
    render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
    expect(screen.getByRole("button", { name: /save privacy settings/i })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /cache extracted page text/i }));
    expect(screen.getByRole("button", { name: /save privacy settings/i })).toBeEnabled();
  });

  it("adds a new PII term of at least 3 characters and calls onSave with it included", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<PrivacySection settings={baseSettings} onSave={onSave} saving={false} />);

    await user.type(screen.getByLabelText("New PII term"), "Sam");
    await user.click(screen.getByRole("button", { name: /add term/i }));
    expect(screen.getByText("Sam")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save privacy settings/i }));
    expect(onSave).toHaveBeenCalledWith({
      store_pdf_copies: true,
      store_extract_cache: false,
      pii_terms: ["Alex", "Sam"],
    });
  });

  it("rejects a term shorter than 3 characters (D10)", async () => {
    const user = userEvent.setup();
    render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
    await user.type(screen.getByLabelText("New PII term"), "Al");
    expect(screen.getByRole("button", { name: /add term/i })).toBeDisabled();
  });

  it("removes a PII term", async () => {
    const user = userEvent.setup();
    render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
    await user.click(screen.getByRole("button", { name: /remove alex/i }));
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
  });
});
