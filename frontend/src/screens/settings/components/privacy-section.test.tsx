import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PrivacySection } from "./privacy-section";
import * as piiLib from "../lib/pii";
import type { Settings } from "../lib/hooks";

const baseSettings: Settings = {
  llm: {
    enabled: false,
    base_url: "",
    api_format: "openai_chat" as const,
    path: "",
    model: "",
    temperature: null,
    max_tokens: null,
    reasoning_effort: "",
    extra_body: {},
    extra_headers: {},
    structured_output: true,
    batch_size: 50,
    timeout_s: 120,
    confidence_threshold: 0.7,
    parse_pages_per_request: 0,
    mode: "none" as const,
    resolved_url: "",
    has_key: false,
  },
  privacy: { store_pdf_copies: true, store_extract_cache: false, pii_terms: ["Alex"] },
  ingest: { always_confirm_extractor: false, default_extractor: "auto" as const, tax_llm_fallback: false, date_format_hints: [], default_currency: "USD" },
  server: { port: 8756 },
};

describe("PrivacySection", () => {
  it("shows existing toggles and PII terms", () => {
    render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
    expect(screen.getByRole("checkbox", { name: /keep a copy/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /cache extracted page text/i })).not.toBeChecked();
    expect(screen.getByText("Alex")).toBeInTheDocument();
  });

  it("says personal-info entries also apply to tax-form text", () => {
    render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
    expect(screen.getByText(/tax-form text/i)).toBeInTheDocument();
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

    await user.type(screen.getByLabelText("New personal info entry"), "Sam");
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    expect(screen.getByText("Sam")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /save privacy settings/i }));
    expect(onSave).toHaveBeenCalledWith({
      store_pdf_copies: true,
      store_extract_cache: false,
      pii_terms: ["Alex", "Sam"],
    });
  });

  it("rejects an entry shorter than 2 characters", async () => {
    const user = userEvent.setup();
    render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
    await user.type(screen.getByLabelText("New personal info entry"), "A");
    expect(screen.getByRole("button", { name: /add entry/i })).toBeDisabled();
  });

  it("removes a PII term", async () => {
    const user = userEvent.setup();
    render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
    await user.click(screen.getByRole("button", { name: /remove alex/i }));
    expect(screen.queryByText("Alex")).not.toBeInTheDocument();
  });

  it("explains what is matched and shows a kind badge per entry", () => {
    render(
      <PrivacySection
        settings={{
          ...baseSettings,
          privacy: { ...baseSettings.privacy, pii_terms: ["Jane Doe", "(312) 555-0100", "12 Oak St"] },
        }}
        onSave={vi.fn()}
        saving={false}
      />,
    );
    expect(screen.getByText(/personal info to remove before sending to an llm/i)).toBeInTheDocument();
    expect(screen.getByText(/\(312\) 555-0100 = 312\.555\.0100 = 3125550100/)).toBeInTheDocument();
    expect(screen.getAllByTestId("pii-kind").map((b) => b.textContent)).toEqual([
      "Name / text",
      "Number / phone",
      "Name / text",
    ]);
  });

  it("badges a newly added phone entry as a number", async () => {
    const user = userEvent.setup();
    render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
    await user.type(screen.getByLabelText("New personal info entry"), "+1 312-555-0100");
    await user.click(screen.getByRole("button", { name: /add entry/i }));
    expect(screen.getAllByTestId("pii-kind").map((b) => b.textContent)).toEqual([
      "Name / text",
      "Number / phone",
    ]);
  });

  describe("Try it", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("sends the sample and the draft entries to the local test endpoint and shows the result", async () => {
      const user = userEvent.setup();
      const spy = vi
        .spyOn(piiLib, "testPii")
        .mockResolvedValue({ redacted_text: "ZELLE FROM [NAME] [PHONE]", count: 2 });
      render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);

      await user.type(screen.getByLabelText("New personal info entry"), "(312) 555-0100");
      await user.click(screen.getByRole("button", { name: /add entry/i }));
      await user.type(screen.getByLabelText("Try it"), "ZELLE FROM DOE, JANE 312.555.0100");
      await user.click(screen.getByRole("button", { name: /test redaction/i }));

      expect(spy).toHaveBeenCalledWith("ZELLE FROM DOE, JANE 312.555.0100", ["Alex", "(312) 555-0100"]);
      expect(await screen.findByTestId("pii-try-it-result")).toHaveTextContent("ZELLE FROM [NAME] [PHONE]");
      expect(screen.getByTestId("pii-try-it-count")).toHaveTextContent("2 personal-info matches removed");
    });

    it("disables the button without sample text and reports a failure without echoing input", async () => {
      const user = userEvent.setup();
      vi.spyOn(piiLib, "testPii").mockRejectedValue(new Error("boom"));
      render(<PrivacySection settings={baseSettings} onSave={vi.fn()} saving={false} />);
      expect(screen.getByRole("button", { name: /test redaction/i })).toBeDisabled();
      await user.type(screen.getByLabelText("Try it"), "secret sample");
      await user.click(screen.getByRole("button", { name: /test redaction/i }));
      expect(await screen.findByText("Could not run the test.")).toBeInTheDocument();
      expect(screen.queryByTestId("pii-try-it-result")).not.toBeInTheDocument();
    });
  });
});

describe("classifyEntry", () => {
  it.each([
    ["(312) 555-0100", "digits"],
    ["3125550100", "digits"],
    ["+1 312.555.0100", "digits"],
    ["123-45-6789", "digits"],
    ["Jane Doe", "text"],
    ["123 Main St", "text"],
    ["123", "text"],
    ["", "text"],
  ])("%s -> %s", (value, kind) => {
    expect(piiLib.classifyEntry(value)).toBe(kind);
  });
});
