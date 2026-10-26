import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LlmRequestPreview, type LlmParsePreview } from "./llm-request-preview";

const DATA: LlmParsePreview = {
  mode: "remote",
  resolved_url: "https://api.example.com/v1",
  model: "m1",
  pages: [1, 3],
  requests: ["FIRST BODY", "SECOND BODY"],
  total_chars: 21,
  redactions: 1,
};

function setup(over: Partial<React.ComponentProps<typeof LlmRequestPreview>> = {}) {
  const fetchPreview = vi.fn(() => Promise.resolve(DATA));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <LlmRequestPreview
        queryKey={["t", 1]}
        fetchPreview={fetchPreview}
        mode="remote"
        endpoint="https://api.example.com/v1"
        selectedPageCount={2}
        {...over}
      />
    </QueryClientProvider>,
  );
  return fetchPreview;
}

describe("LlmRequestPreview", () => {
  it("is collapsed by default, shows a summary, and fetches only when expanded", async () => {
    const fetchPreview = setup();
    const toggle = screen.getByRole("button", { name: "Show what would be sent" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("llm-preview-summary")).toHaveTextContent("Remote model");
    expect(screen.getByTestId("llm-preview-summary")).toHaveTextContent("api.example.com");
    expect(screen.getByTestId("llm-preview-summary")).toHaveTextContent("2 pages");
    expect(screen.queryByTestId("llm-request")).not.toBeInTheDocument();
    expect(fetchPreview).not.toHaveBeenCalled();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const blocks = await screen.findAllByTestId("llm-request");
    expect(blocks.map((b) => b.textContent)).toEqual(["FIRST BODY", "SECOND BODY"]);
    expect(fetchPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("llm-preview-summary")).toHaveTextContent("21 characters total");
    expect(screen.getByTestId("llm-redactions")).toHaveTextContent("1 personal-info match removed");
  });

  it("keeps the bodies in one fixed-height scrollable monospace region", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Show what would be sent" }));
    const region = await screen.findByTestId("llm-preview-scroll");
    expect(region.className).toMatch(/max-h-96/);
    expect(region.className).toMatch(/overflow-auto/);
    expect(screen.getAllByTestId("llm-request")[0]?.className).toMatch(/font-mono/);
  });

  it("collapses again and shows the bodies again when re-expanded", async () => {
    setup();
    const toggle = screen.getByRole("button", { name: "Show what would be sent" });
    await userEvent.click(toggle);
    await screen.findAllByTestId("llm-request");
    await userEvent.click(screen.getByRole("button", { name: "Hide what would be sent" }));
    expect(screen.queryByTestId("llm-request")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Show what would be sent" }));
    await waitFor(() => expect(screen.getAllByTestId("llm-request")).toHaveLength(2));
  });

  it("is disabled when not enabled", () => {
    setup({ enabled: false });
    expect(screen.getByRole("button", { name: "Show what would be sent" })).toBeDisabled();
  });

  it("explains an empty preview", async () => {
    const fetchPreview = vi.fn(() => Promise.resolve({ ...DATA, mode: "none" as const, requests: [], pages: [] }));
    setup({ fetchPreview });
    await userEvent.click(screen.getByRole("button", { name: "Show what would be sent" }));
    expect(await screen.findByText(/No LLM is configured/)).toBeInTheDocument();
  });
});
