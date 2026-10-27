import type * as React from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";

import { Toaster } from "@/components/ui/toaster";
import { ToastContextProvider } from "@/components/ui/toast-provider";
import { ErrorBoundary } from "@/components/primitives/error-boundary";
import { cn } from "@/utils";
import { ComparePanes } from "@/components/shell/compare-panes";
import { UserBar } from "@/components/shell/user-bar";
import { COMPARE_USER_PARAM, useCompareUser, useSelectedUser } from "@/hooks/use-selected-user";
import { ComponentGallery } from "@/routes/gallery";

import DashboardScreen, { screenMeta as dashboardMeta } from "@/screens/dashboard";
import ImportScreen, { screenMeta as importMeta } from "@/screens/import";
import ReviewScreen, { screenMeta as reviewMeta } from "@/screens/review";
import TransactionsScreen, { screenMeta as transactionsMeta } from "@/screens/transactions";
import TaxScreen, { screenMeta as taxMeta } from "@/screens/tax";
import RulesScreen, { screenMeta as rulesMeta } from "@/screens/rules";
import SettingsScreen, { screenMeta as settingsMeta } from "@/screens/settings";
import LayoutMapperScreen, { screenMeta as layoutMapperMeta } from "@/screens/layout-mapper";

/**
 * The Phase 3 screens (plus Income & Tax), in the order they appear in the main nav. `screenMeta.path` on each
 * screen is the source of truth for its route; this array is only display order.
 */
const SCREENS = [
  { meta: dashboardMeta, Component: DashboardScreen },
  { meta: importMeta, Component: ImportScreen },
  { meta: reviewMeta, Component: ReviewScreen },
  { meta: transactionsMeta, Component: TransactionsScreen },
  { meta: taxMeta, Component: TaxScreen },
  { meta: rulesMeta, Component: RulesScreen },
  { meta: settingsMeta, Component: SettingsScreen },
  { meta: layoutMapperMeta, Component: LayoutMapperScreen },
] as const;

/**
 * The app shell: nav, providers, error boundary, and every screen's route, wired from each
 * screen's own `screenMeta` (§ Phase 3 screen contract) plus the `/gallery` route P1-F's
 * Accepts criteria requires. The Layout mapper is reachable only as a deep link from Import's
 * `unsupported_layout` failure (and from Rules' Extractors tab), so it stays out of the primary
 * nav to avoid suggesting it is a everyday destination. `/gallery` (a developer tool, not a
 * user-facing screen) is left off the nav entirely — the route itself still works as a direct
 * link — rather than appended to it, so it never reads as an eighth "screen" alongside the app's
 * real ones.
 */
/** Routes with no per-user view at all: the global user bar is hidden there. */
const NO_USER_BAR_PATHS: readonly string[] = [settingsMeta.path, "/gallery"];
/** Screens that can be rendered twice (left/right) in compare mode. */
const COMPARE_PATHS: readonly string[] = [dashboardMeta.path, reviewMeta.path, transactionsMeta.path, taxMeta.path];
/** Per-route clarifications shown next to the user bar. */
const ROUTE_NOTES: Record<string, string> = {
  [rulesMeta.path]: "Rules apply to all users.",
};

export function App() {
  return (
    <ToastContextProvider>
      <Shell />
      <Toaster />
    </ToastContextProvider>
  );
}

function Shell() {
  const { pathname, search } = useLocation();
  const sel = useSelectedUser();
  const compare = useCompareUser(sel.selectedUserId, sel.users, sel.isLoading);

  const showBar = !NO_USER_BAR_PATHS.includes(pathname);
  const compareSupported = COMPARE_PATHS.includes(pathname);
  const comparing = showBar && compareSupported && compare.active;
  const compareParam = new URLSearchParams(search).get(COMPARE_USER_PARAM);

  function changePrimary(id: number | null) {
    // Picking the user already on the right swaps the panes instead of showing one user twice.
    if (compare.active && id === compare.compareUserId) compare.setPair(id, sel.selectedUserId);
    else sel.setSelectedUserId(id);
  }
  function changeCompare(id: number | null) {
    if (id === sel.selectedUserId) compare.setPair(compare.compareUserId, id);
    else compare.setCompareUserId(id);
  }

  const routes = (
    <ErrorBoundary>
      <Routes>
        {SCREENS.map(({ meta, Component }) => (
          <Route key={meta.path} path={meta.path} element={<Component />} />
        ))}
        <Route path="/gallery" element={<ComponentGallery />} />
      </Routes>
    </ErrorBoundary>
  );

  const nameOf = (id: number | null) => sel.users.find((u) => u.id === id)?.name ?? "";

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 bg-background">
        <div className="border-b border-border">
          <nav className="mx-auto flex max-w-screen-2xl flex-wrap items-center gap-4 px-4 py-3">
            <span className="text-sm font-semibold tracking-tight">Spend Analyzer</span>
            {SCREENS.filter((s) => s.meta.path !== "/layout-mapper").map((s) => (
              <NavItem
                key={s.meta.path}
                to={{
                  pathname: s.meta.path,
                  // Keep an active compare across the screens that support it.
                  search: compareParam && COMPARE_PATHS.includes(s.meta.path) ? `?${COMPARE_USER_PARAM}=${compareParam}` : "",
                }}
                end={s.meta.path === "/"}
              >
                {s.meta.title}
              </NavItem>
            ))}
          </nav>
        </div>
        {showBar ? (
          <UserBar
            users={sel.users}
            isLoading={sel.isLoading}
            primaryId={sel.selectedUserId}
            onPrimaryChange={changePrimary}
            compareSupported={compareSupported}
            compareActive={comparing}
            compareUserId={compare.compareUserId}
            onCompareToggle={compare.setEnabled}
            onCompareUserChange={changeCompare}
            note={ROUTE_NOTES[pathname]}
          />
        ) : null}
      </header>
      <main
        className={cn(
          "mx-auto flex w-full flex-1 flex-col px-4 py-6",
          comparing ? "max-w-screen-2xl" : "max-w-6xl",
        )}
      >
        {comparing ? (
          <ComparePanes
            showShortcutBadge={pathname === reviewMeta.path}
            panes={[
              { side: "left", userId: sel.selectedUserId, name: nameOf(sel.selectedUserId), setUserId: changePrimary },
              { side: "right", userId: compare.compareUserId, name: nameOf(compare.compareUserId), setUserId: changeCompare },
            ]}
          >
            {() => routes}
          </ComparePanes>
        ) : (
          routes
        )}
      </main>
    </div>
  );
}

function NavItem({ to, end, children }: { to: React.ComponentProps<typeof NavLink>["to"]; end: boolean; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground",
          isActive && "bg-muted text-foreground",
        )
      }
    >
      {children}
    </NavLink>
  );
}
