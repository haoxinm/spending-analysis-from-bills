import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { components } from "@/api/client";

import { TaxonomyTab } from "./taxonomy-tab";
import { type ApiHandler, setMockHandlers, TestProviders } from "./test-utils";

vi.mock("@/api/client", async () => {
  const { dynamicMockFetch } = await import("./test-utils");
  vi.stubGlobal("fetch", dynamicMockFetch);
  return vi.importActual("@/api/client");
});

type Category = components["schemas"]["Category"];

const TAXONOMY: Category[] = [
  {
    key: "food",
    name: "Food",
    subcategories: [
      { key: "groceries", name: "Groceries", pending: false },
      { key: "warehouse_club", name: "Warehouse club", pending: true },
    ],
  },
  {
    key: "others",
    name: "Others",
    subcategories: [{ key: "uncategorized", name: "Uncategorized", pending: false }],
  },
];

function setUpHandlers(overrides: Partial<Record<string, ApiHandler>> = {}) {
  setMockHandlers({ "GET /taxonomy": () => TAXONOMY, ...overrides });
}

describe("TaxonomyTab", () => {
  beforeEach(() => {
    setUpHandlers();
  });

  it("renders every category with its subcategories", async () => {
    render(<TaxonomyTab />, { wrapper: TestProviders });

    expect(await screen.findByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Others")).toBeInTheDocument();
    expect(screen.getByText("Groceries")).toBeInTheDocument();
    expect(screen.getByText("Warehouse club")).toBeInTheDocument();
    expect(screen.getByText("Uncategorized")).toBeInTheDocument();
  });

  it("badges a pending subcategory and counts it in the summary line", async () => {
    render(<TaxonomyTab />, { wrapper: TestProviders });

    await screen.findByText("Warehouse club");
    expect(screen.getByText("pending approval")).toBeInTheDocument();
    expect(screen.getByText("1 subcategory awaiting approval or merge.")).toBeInTheDocument();
  });

  it("disables approve/merge for a pending subcategory pending the missing numeric id", async () => {
    render(<TaxonomyTab />, { wrapper: TestProviders });
    await screen.findByText("Warehouse club");

    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Merge" })).toBeDisabled();
  });

  it("shows a merged badge instead of actions for an already-merged subcategory", async () => {
    setUpHandlers({
      "GET /taxonomy": () => [
        {
          key: "food",
          name: "Food",
          subcategories: [
            { key: "warehouse_club", name: "Warehouse club", pending: true, merged_into: "groceries" },
          ],
        },
      ],
    });
    render(<TaxonomyTab />, { wrapper: TestProviders });

    expect(await screen.findByText("merged into groceries")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});
