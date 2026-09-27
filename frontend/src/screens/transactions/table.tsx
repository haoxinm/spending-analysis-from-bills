import { getCoreRowModel, useReactTable, flexRender } from "@tanstack/react-table";
import * as React from "react";

import { cn } from "@/utils";

import { createColumns, type ColumnsContext } from "./columns";
import type { Transaction } from "./types";
import { useVirtualRows } from "./use-virtual-rows";

const ROW_HEIGHT = 44;
/** The grid's fixed viewport height (px). A fixed height is what makes windowing possible
 *  without measuring layout on every render. */
const VIEWPORT_HEIGHT = 560;

export interface TransactionsTableProps {
  rows: Transaction[];
  context: ColumnsContext;
  onRowClick?: (transaction: Transaction) => void;
  /** Called when the user scrolls within `overscan` rows of the bottom, to page in more data
   *  (the caller is the one that knows whether there is a next page to fetch). */
  onNearEnd?: () => void;
}

/**
 * The transactions grid itself: a `@tanstack/react-table` column/row model (already a
 * dependency — no table logic is hand-rolled) rendered through the local windowing hook, so
 * only the rows within the visible range are ever mounted. `columns` is memoized on the
 * pieces of `context` that actually change (selection and the taxonomy list), never rebuilt
 * on every keystroke elsewhere on the page.
 */
export function TransactionsTable({ rows, context, onRowClick, onNearEnd }: TransactionsTableProps) {
  const columns = React.useMemo(
    () => createColumns(context),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- context is a plain object; depend on its fields, not its identity.
    [context.categories, context.selectedIds, context.onToggleRow, context.onEdit],
  );

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => String(row.id),
  });

  const tableRows = table.getRowModel().rows;
  const { containerRef, range, onScroll } = useVirtualRows({
    rowCount: tableRows.length,
    rowHeight: ROW_HEIGHT,
    overscan: 10,
  });

  const handleScroll = React.useCallback(
    (e: React.UIEvent<HTMLDivElement>) => {
      onScroll();
      const el = e.currentTarget;
      if (onNearEnd && el.scrollHeight - el.scrollTop - el.clientHeight < ROW_HEIGHT * 20) {
        onNearEnd();
      }
    },
    [onScroll, onNearEnd],
  );

  const visibleRows = tableRows.slice(range.startIndex, range.endIndex);

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <div className="flex border-b border-border bg-muted/50 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {table.getFlatHeaders().map((header) => (
          <div
            key={header.id}
            className="flex items-center px-3 py-2"
            style={{ flex: header.column.getSize() ? `0 0 ${header.column.getSize()}px` : "1 1 auto" }}
          >
            {flexRender(header.column.columnDef.header, header.getContext())}
          </div>
        ))}
      </div>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        role="table"
        aria-rowcount={tableRows.length}
        className="overflow-auto"
        style={{ height: VIEWPORT_HEIGHT }}
        data-testid="transactions-viewport"
      >
        <div style={{ paddingTop: range.paddingTop, paddingBottom: range.paddingBottom }}>
          {visibleRows.map((row) => (
            <div
              key={row.id}
              role="row"
              className={cn(
                "flex cursor-pointer items-center border-b border-border/60 text-sm hover:bg-muted/40",
                context.selectedIds.has(row.original.id) && "bg-primary/5",
              )}
              style={{ height: ROW_HEIGHT }}
              onClick={() => onRowClick?.(row.original)}
            >
              {row.getVisibleCells().map((cell) => (
                <div
                  key={cell.id}
                  className="flex items-center overflow-hidden px-3"
                  style={{
                    flex: cell.column.getSize() ? `0 0 ${cell.column.getSize()}px` : "1 1 auto",
                  }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
