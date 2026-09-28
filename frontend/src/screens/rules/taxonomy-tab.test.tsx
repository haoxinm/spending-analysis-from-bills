import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
      { id: 1, key: "groceries", name: "Groceries", pending: false },
      { id: 2, key: "warehouse_club", name: "Warehouse club", pending: true },
    ],
  },
  {
    key: "others",
    name: "Others",
    subcategories: [{ id: 3, key: "uncategorized", name: "Uncategorized", pending: false }],
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

  it("approves a pending subcategory by its numeric id", async () => {
    const approveCalls: number[] = [];
    setUpHandlers({
      "GET /taxonomy": () => TAXONOMY,
      "POST /approve": (req) => {
        const id = Number(new URL(req.url).pathname.split("/").at(-2));
        approveCalls.push(id);
        return { ...TAXONOMY[0]?.subcategories[1], pending: false };
      },
    });
    render(<TaxonomyTab />, { wrapper: TestProviders });
    await screen.findByText("Warehouse club");

    await userEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(approveCalls).toEqual([2]));
  });

  it("merges a pending subcategory into a chosen target by numeric id", async () => {
    const mergeCalls: Array<{ id: number; into_id: number }> = [];
    setUpHandlers({
      "GET /taxonomy": () => TAXONOMY,
      "POST /merge": async (req) => {
        const id = Number(new URL(req.url).pathname.split("/").at(-2));
        const body = (await req.clone().json()) as { into_id: number };
        mergeCalls.push({ id, into_id: body.into_id });
        return { ...TAXONOMY[0]?.subcategories[1], merged_into: String(body.into_id) };
      },
    });
    render(<TaxonomyTab />, { wrapper: TestProviders });
    await screen.findByText("Warehouse club");

    await userEvent.selectOptions(
      screen.getByLabelText("Merge Warehouse club into"),
      "food / Groceries",
    );
    await userEvent.click(screen.getByRole("button", { name: "Merge" }));

    await waitFor(() => expect(mergeCalls).toEqual([{ id: 2, into_id: 1 }]));
  });

  it("shows a merged badge instead of actions for an already-merged subcategory", async () => {
    setUpHandlers({
      "GET /taxonomy": () => [
        {
          key: "food",
          name: "Food",
          subcategories: [
            { id: 2, key: "warehouse_club", name: "Warehouse club", pending: true, merged_into: "groceries" },
          ],
        },
      ],
    });
    render(<TaxonomyTab />, { wrapper: TestProviders });

    expect(await screen.findByText("merged into groceries")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });
});
