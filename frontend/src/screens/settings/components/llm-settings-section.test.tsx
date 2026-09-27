import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToastContextProvider } from "@/components/ui/toast-provider";

import { LlmSettingsSection } from "./llm-settings-section";
import type { Settings } from "../lib/hooks";

const setApiKeyMutate = vi.fn();
const clearApiKeyMutate = vi.fn();
const testLlmMutate = vi.fn();

vi.mock("../lib/hooks", () => ({
  useSetApiKey: () => ({ mutate: setApiKeyMutate, isPending: false }),
  useClearApiKey: () => ({ mutate: clearApiKeyMutate, isPending: false }),
  useTestLlm: () => ({ mutate: testLlmMutate, isPending: false, isError: false, error: null }),
}));

const noneSettings: Settings = {
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
  privacy: { store_pdf_copies: true, store_extract_cache: false, pii_terms: [] },
  ingest: { always_confirm_extractor: false, date_format_hints: [], default_currency: "USD" },
  server: { port: 8756 },
};

const remoteSettings: Settings = {
  ...noneSettings,
  llm: { ...noneSettings.llm, mode: "remote", provider: "anthropic", model: "claude", has_key: true },
};

function renderSection(settings: Settings, onSave = vi.fn()) {
  return render(
    <ToastContextProvider>
      <LlmSettingsSection settings={settings} onSave={onSave} saving={false} />
    </ToastContextProvider>,
  );
}

describe("LlmSettingsSection", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("labels every mode with its egress consequence in plain language (D2)", () => {
    renderSection(noneSettings);
    expect(screen.getByText(/nothing is ever sent anywhere/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing leaves your machine/i)).toBeInTheDocument();
    expect(screen.getByText(/sent to the provider below/i)).toBeInTheDocument();
  });

  it("hides provider/model/key fields in 'No LLM' mode", () => {
    renderSection(noneSettings);
    expect(screen.queryByLabelText("New API key")).not.toBeInTheDocument();
  });

  it("never displays the existing API key, only whether one is on file", () => {
    renderSection(remoteSettings);
    expect(screen.getByText("Key on file")).toBeInTheDocument();
    expect(screen.getByLabelText("New API key")).toHaveValue("");
    expect(screen.getByLabelText("New API key")).toHaveAttribute("type", "password");
  });

  it("saves a new API key and clears the input, without ever calling onSave with it", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    setApiKeyMutate.mockImplementation((_vars, opts: { onSuccess?: () => void }) => opts.onSuccess?.());
    renderSection(remoteSettings, onSave);

    await user.type(screen.getByLabelText("New API key"), "sk-new-secret");
    await user.click(screen.getByRole("button", { name: /save key/i }));

    expect(setApiKeyMutate).toHaveBeenCalledWith(
      { provider: "anthropic", apiKey: "sk-new-secret" },
      expect.anything(),
    );
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByLabelText("New API key")).toHaveValue("");
  });

  it("saves the rest of the LLM settings via onSave, disabled until something changes", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    renderSection(remoteSettings, onSave);

    expect(screen.getByRole("button", { name: /save llm settings/i })).toBeDisabled();
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "claude-new");
    await user.click(screen.getByRole("button", { name: /save llm settings/i }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-new" }));
  });

  it("shows the base URL field only for a local provider", () => {
    renderSection({ ...remoteSettings, llm: { ...remoteSettings.llm, mode: "local", provider: "ollama" } });
    expect(screen.getByLabelText("Base URL")).toBeInTheDocument();
  });
});
