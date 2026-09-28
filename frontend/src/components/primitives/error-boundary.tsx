import * as React from "react";

import { ErrorState } from "@/components/primitives/states";

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Rendered in place of the default `ErrorState` when set. Receives the caught error. */
  fallback?: (error: Error, reset: () => void) => React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * A screen-level error boundary. Phase 3 wraps each screen (or the whole route tree) in this
 * so a rendering exception in one view shows a recoverable error card instead of a blank
 * white page. It never catches errors surfaced through TanStack Query's own `error` state —
 * those render through `ErrorState` directly, without throwing.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Last-resort visibility; no telemetry is sent (I8) — this never leaves the machine.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <ErrorState
        title="This screen hit an error"
        description={error.message}
        onRetry={this.reset}
      />
    );
  }
}
