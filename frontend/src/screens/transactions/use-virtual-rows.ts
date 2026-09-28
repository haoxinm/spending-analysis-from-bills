import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
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

/** Turns `@tanstack/react-virtual`'s `getVirtualItems()`/`getTotalSize()` into this screen's own
 * `{ startIndex, endIndex, paddingTop, paddingBottom }` shape — the row-slice-plus-spacers
 * contract `table.tsx` renders off, unchanged since before this hook was backed by the real
 * package. */
function toWindowRange(items: VirtualItem[], totalSize: number, rowCount: number): WindowRange {
  if (rowCount <= 0 || items.length === 0) {
    return { startIndex: 0, endIndex: 0, paddingTop: 0, paddingBottom: 0 };
  }
  const first = items[0]!;
  const last = items[items.length - 1]!;
  return {
    startIndex: first.index,
    endIndex: last.index + 1,
    paddingTop: first.start,
    paddingBottom: Math.max(0, totalSize - (last.start + last.size)),
  };
}

/**
 * Row windowing for the transactions grid, backed by `@tanstack/react-virtual` (MIT): only the
 * rows in the visible window (plus `overscan`) are ever mounted, so the grid stays smooth at
 * 10k+ rows (§6.6's TTI budget). `table.tsx` renders off `{ containerRef, range, onScroll }`;
 * `onScroll` is a no-op here (the virtualizer subscribes to the scroll container itself) and is
 * kept only so `table.tsx`'s `onScroll={handleScroll}` composition (which also drives
 * `onNearEnd` pagination) needs no change.
 */
export function useVirtualRows({ rowCount, rowHeight, overscan = 8 }: UseVirtualRowsOptions) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  const range = toWindowRange(virtualizer.getVirtualItems(), virtualizer.getTotalSize(), rowCount);

  return { containerRef, range, onScroll: () => {} };
}
