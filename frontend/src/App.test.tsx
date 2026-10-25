import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

/** Every route's own data hooks run against this one blanket mock — only the route that
 * actually matches ever mounts (`react-router` renders one `Route` element at a time), so this
 * never needs to be more specific than "anything under /api gets an empty, well-typed body". */
async function renderApp(path: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(() => Promise.resolve(jsonResponse([]))),
  );
  vi.resetModules();
  const [{ App }] = await Promise.all([import("./App")]);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function navLinkClassName(name: string): string {
  return screen.getByRole("link", { name }).className;
}

describe("App shell nav", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not list Component gallery in the main nav", async () => {
    await renderApp("/");
    expect(screen.queryByRole("link", { name: "Component gallery" })).not.toBeInTheDocument();
  });

  it("marks Dashboard active on '/'", async () => {
    await renderApp("/");
    expect(navLinkClassName("Dashboard")).toContain("bg-muted");
  });

  /**
   * Regression coverage for a real bug: Layout mapper is a deep-link-only screen deliberately
   * left out of the primary nav (`App.tsx`), so none of the *visible* nav items' routes match
   * `/layout-mapper` — but a stale highlight was seen there (Settings). Every nav link's own
   * `NavLink` `isActive` match against the current location is the only thing that should ever
   * add the active classes, so none of them should on a route none of them own.
   */
  it("leaves every nav item un-highlighted on /layout-mapper", async () => {
    await renderApp("/layout-mapper");
    // "bg-muted" only ever appears together with the active state (see `NavItem` in `App.tsx`):
    // `hover:text-foreground` is present on every link regardless, so it isn't a useful signal.
    for (const name of ["Dashboard", "Import", "Review", "Transactions", "Rules", "Settings"]) {
      expect(navLinkClassName(name)).not.toContain("bg-muted");
    }
  });
});
