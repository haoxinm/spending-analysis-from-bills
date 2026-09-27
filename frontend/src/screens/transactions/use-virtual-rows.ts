import * as React from "react";

export interface WindowRange {
  /** First rendered row index, inclusive. */
  startIndex: number;
  /** Last rendered row index, exclusive. */
  endIndex: number;
  /** Spacer height (px) above the rendered rows, standing in for the rows scrolled past. */
  paddingTop: number;
  /** Spacer height (px) below the rendered rows, standing in for the rows not yet reached. */
  paddingBottom: number;
}

export interface UseVirtualRowsOptions {
  /** Total row count in the (already-filtered, already-loaded) data set. */
  rowCount: number;
  /** Fixed row height in px. Every row must be the same height for windowing to be O(1). */
  rowHeight: number;
  /** Extra rows rendered above/below the visible viewport, so a fast scroll or keyboard
   *  navigation doesn't flash an empty row before the next frame renders it. */
  overscan?: number;
}

/**
 * Given a scroll position and viewport height, returns the slice of row indices that should
 * actually be mounted, padded with spacer heights so the scrollbar's size and position stay
 * correct for the *full* `rowCount` even though only a window of rows exists in the DOM.
 *
 * Pure and framework-free on purpose: `useVirtualRows` below is the only thing that touches
 * the DOM, so this function is trivial to unit-test and to swap for `@tanstack/react-virtual`
 * (see the P3-C report: that package is not yet in `package.json`) without touching call sites.
 */
export function computeRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  rowHeight: number,
  overscan: number,
): WindowRange {
  if (rowCount <= 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const visibleCount = Math.ceil(Math.max(viewportHeight, 0) / rowHeight) + 1;
  const startIndex = Math.max(0, Math.min(rowCount, firstVisible) - overscan);
  const endIndex = Math.max(startIndex, Math.min(rowCount, firstVisible + visibleCount + overscan));
  return {
    startIndex,
    endIndex,
    paddingTop: startIndex * rowHeight,
    paddingBottom: (rowCount - endIndex) * rowHeight,
  };
}

/**
 * A minimal, dependency-free row-windowing fallback for the transactions grid. `@tanstack/
 * react-virtual` is not in `frontend/package.json` (a P3_BRIEF-flagged dependency this screen
 * needs but may not add itself — see the report), so this hook implements the same idea by
 * hand: track the scroll container's `scrollTop`/`clientHeight`, and mount only the rows in
 * `computeRange`'s window. Swapping in the real package later means replacing this hook's
 * internals only; every caller (`table.tsx`) already renders off `{ containerRef, range,
 * onScroll }`, which lines up with `useVirtualizer`'s own shape.
 */
export function useVirtualRows({ rowCount, rowHeight, overscan = 8 }: UseVirtualRowsOptions) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [range, setRange] = React.useState<WindowRange>(() =>
    computeRange(0, 0, rowCount, rowHeight, overscan),
  );

  const recompute = React.useCallback(() => {
    const el = containerRef.current;
    const scrollTop = el?.scrollTop ?? 0;
    const viewportHeight = el?.clientHeight ?? 0;
    setRange(computeRange(scrollTop, viewportHeight, rowCount, rowHeight, overscan));
  }, [rowCount, rowHeight, overscan]);

  React.useEffect(() => {
    recompute();
  }, [recompute]);

  React.useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(el);
    return () => observer.disconnect();
  }, [recompute]);

  return { containerRef, range, onScroll: recompute };
}
