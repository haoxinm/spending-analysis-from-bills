import type * as React from "react";
import { NavLink, Route, Routes } from "react-router-dom";

import { Toaster } from "@/components/ui/toaster";
import { ToastContextProvider } from "@/components/ui/toast-provider";
import { ErrorBoundary } from "@/components/primitives/error-boundary";
import { cn } from "@/utils";
import { ComponentGallery } from "@/routes/gallery";

/**
 * The app shell. Phase 3 screens mount under `/` as sibling `<Route>`s (each owns its own
 * `src/screens/<screen>/` directory); this WP does not create any screen route, only the
 * shell, the shared providers, and the `/gallery` route the Accepts criteria requires.
 */
export function App() {
  return (
    <ToastContextProvider>
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
            <span className="text-sm font-semibold tracking-tight">Spend Analyzer</span>
            <NavItem to="/">Home</NavItem>
            <NavItem to="/gallery">Component gallery</NavItem>
          </nav>
        </header>
        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<Home />} />
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

function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Spend Analyzer</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        This is the P1-F scaffold: design system, typed API client, and shared primitives.
        Phase 3 fills in the Import, Review, Transactions, Dashboard, Settings, Rules and
        Layout mapper screens here.
      </p>
    </div>
  );
}
