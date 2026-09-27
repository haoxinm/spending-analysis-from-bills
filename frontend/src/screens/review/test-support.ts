import type { Category, Transaction } from "./types";

export function makeTransaction(overrides: Partial<Transaction> & { id: number }): Transaction {
  return {
    statement_id: 1,
    account_id: 1,
    posted_date: "2026-01-01",
    transaction_date: null,
    description_clean: `Merchant ${overrides.id}`,
    amount_minor: 1000,
    currency: "USD",
    kind: "purchase",
    category_key: "others",
    subcategory_key: "uncategorized",
    merchant_key: `merchant-${overrides.id}`,
    notes: null,
    needs_review: true,
    ...overrides,
  };
}

export function makeCategory(overrides: Partial<Category> & { key: string }): Category {
  return {
    name: overrides.key,
    subcategories: [],
    ...overrides,
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A `fetch` stub covering every endpoint this screen calls: `GET`/`PATCH /transactions[/{id}]`
 * (§3.12, paginated the way the real backend does) and `GET /taxonomy` plus its subcategory
 * `approve`/`merge` actions. Pass only the state a given test needs; unhandled requests throw,
 * so a test that reaches an unmocked call fails loudly instead of hanging.
 */
export function createApiFetchMock(state: {
  transactions?: Transaction[];
  categories?: Category[];
  patchTransactionBehavior?: (id: number, body: unknown) => Response;
  approveBehavior?: (subcategoryId: number) => Response;
  mergeBehavior?: (subcategoryId: number, intoId: number) => Response;
}) {
  const transactions = state.transactions ?? [];
  let categories = state.categories ?? [];

  return async (input: Request | string | URL): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input);
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/transactions") {
      const page = Number(url.searchParams.get("page") ?? "1");
      const pageSize = Number(url.searchParams.get("page_size") ?? "50");
      const start = (page - 1) * pageSize;
      return jsonResponse({
        items: transactions.slice(start, start + pageSize),
        total: transactions.length,
      });
    }

    const patchMatch = /^\/api\/transactions\/(\d+)$/.exec(url.pathname);
    if (request.method === "PATCH" && patchMatch) {
      const id = Number(patchMatch[1]);
      // Clone before reading: the caller may want to inspect the request body afterwards
      // (`fetchMock.mock.calls`), and a `Request`'s body stream can only be read once.
      const body: unknown = await request.clone().json();
      if (state.patchTransactionBehavior) return state.patchTransactionBehavior(id, body);
      return jsonResponse({
        ...makeTransaction({ id }),
        needs_review: false,
        ...(body as Partial<Transaction>),
      });
    }

    if (request.method === "GET" && url.pathname === "/api/taxonomy") {
      return jsonResponse(categories);
    }

    const approveMatch = /^\/api\/taxonomy\/subcategories\/(\d+)\/approve$/.exec(url.pathname);
    if (request.method === "POST" && approveMatch) {
      const subcategoryId = Number(approveMatch[1]);
      if (state.approveBehavior) return state.approveBehavior(subcategoryId);
      categories = categories.map((cat) => ({
        ...cat,
        subcategories: cat.subcategories.map((sub) =>
          "id" in sub && sub.id === subcategoryId ? { ...sub, pending: false } : sub,
        ),
      }));
      const approved = categories.flatMap((cat) => cat.subcategories).find((sub) => "id" in sub && sub.id === subcategoryId);
      return jsonResponse(approved);
    }

    const mergeMatch = /^\/api\/taxonomy\/subcategories\/(\d+)\/merge$/.exec(url.pathname);
    if (request.method === "POST" && mergeMatch) {
      const subcategoryId = Number(mergeMatch[1]);
      const body = (await request.clone().json()) as { into_id: number };
      if (state.mergeBehavior) return state.mergeBehavior(subcategoryId, body.into_id);
      categories = categories.map((cat) => ({
        ...cat,
        subcategories: cat.subcategories.map((sub) =>
          "id" in sub && sub.id === subcategoryId
            ? { ...sub, merged_into: String(body.into_id) }
            : sub,
        ),
      }));
      const merged = categories.flatMap((cat) => cat.subcategories).find((sub) => "id" in sub && sub.id === subcategoryId);
      return jsonResponse(merged);
    }

    throw new Error(`unhandled request in test: ${request.method} ${url.pathname}`);
  };
}
