import type * as React from "react";
import { NavLink, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/toaster";
import { ToastContextProvider } from "@/components/ui/toast-provider";
import { ErrorBoundary } from "@/components/primitives/error-boundary";
import { cn } from "@/utils";
import { ComponentGallery } from "@/routes/gallery";

import DashboardScreen, { screenMeta as dashboardMeta } from "@/screens/dashboard";
import ImportScreen, { screenMeta as importMeta } from "@/screens/import";
import ReviewScreen, { screenMeta as reviewMeta } from "@/screens/review";
import TransactionsScreen, { screenMeta as transactionsMeta } from "@/screens/transactions";
import RulesScreen, { screenMeta as rulesMeta } from "@/screens/rules";
import SettingsScreen, { screenMeta as settingsMeta } from "@/screens/settings";
import LayoutMapperScreen, { screenMeta as layoutMapperMeta } from "@/screens/layout-mapper";

/**
 * The seven Phase 3 screens, in the order they appear in the main nav. `screenMeta.path` on each
 * screen is the source of truth for its route; this array is only display order.
 */
const SCREENS = [
  { meta: dashboardMeta, Component: DashboardScreen },
  { meta: importMeta, Component: ImportScreen },
  { meta: reviewMeta, Component: ReviewScreen },
  { meta: transactionsMeta, Component: TransactionsScreen },
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
export function App() {
  return (
    <ToastContextProvider>
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
            <span className="text-sm font-semibold tracking-tight">Spend Analyzer</span>
            {SCREENS.filter((s) => s.meta.path !== "/layout-mapper").map((s) => (
              <NavItem key={s.meta.path} to={s.meta.path}>
                {s.meta.title}
              </NavItem>
            ))}
          </nav>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
          <ErrorBoundary>
            <Routes>
              {SCREENS.map(({ meta, Component }) => (
                <Route key={meta.path} path={meta.path} element={<Component />} />
              ))}
              <Route path="/gallery" element={<ComponentGallery />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
      <Toaster />
    </ToastContextProvider>
  );
}

function NavItem({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
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
