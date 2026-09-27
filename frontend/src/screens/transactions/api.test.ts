import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toTransactionsQuery } from "./api";

describe("toTransactionsQuery", () => {
  it("maps the SpendQueryParams subset onto GET /transactions's own query names", () => {
    expect(
      toTransactionsQuery({
        userIds: [1, 2],
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        categoryKeys: ["groceries"],
        amountMinMinor: 100,
        kinds: ["purchase"],
        search: "coffee",
      }),
    ).toEqual({
      user_ids: [1, 2],
      account_ids: undefined,
      date_from: "2026-01-01",
      date_to: "2026-01-31",
      category_keys: ["groceries"],
      subcategory_keys: undefined,
      amount_min_minor: 100,
      amount_max_minor: undefined,
      kinds: ["purchase"],
      include_non_spend: undefined,
      search: "coffee",
      currency: undefined,
    });
  });

  it("drops analytics-only fields (granularity, groupBy, netRefunds) that GET /transactions doesn't accept", () => {
    const query = toTransactionsQuery({
      granularity: "month",
      groupBy: ["category"],
      netRefunds: true,
    } as never);
    expect(query).not.toHaveProperty("granularity");
    expect(query).not.toHaveProperty("group_by");
    expect(query).not.toHaveProperty("net_refunds");
  });
});

describe("downloadTransactionsExport", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches the export and triggers a same-shaped file download", async () => {
    const fetchMock = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response("id,amount_minor\n1,1234\n", {
          status: 200,
          headers: { "Content-Type": "text/csv" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    // jsdom doesn't implement these; define them before spying so `vi.spyOn` has something
    // to wrap.
    if (!URL.createObjectURL) URL.createObjectURL = () => "";
    if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {};
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:mock");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const { downloadTransactionsExport } = await import("./api");
    await downloadTransactionsExport("csv");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls.at(0)?.[0] as Request | undefined;
    expect(request?.url).toContain("/api/export");
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});
