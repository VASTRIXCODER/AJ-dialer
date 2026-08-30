"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useDensity } from "@/components/layout/density";
import { CELL, ROW_MIN, type Density } from "@/lib/ui-density";

// ─────────────────────────────────────────────────────────────────────────────
// DataTable — a lightweight, GENERIC table for list views (the floor's list
// mode first; leads/reports adopt it later). Deliberately dumb: sorting is
// controlled by the caller (`sort` + `onSort`), rendering is per-column render
// functions, and the component owns only the semantics — a real <table> with
// scope="col" headers, aria-sort on the active column, and its own horizontal
// scroll container so a wide table never scrolls the page body sideways.
// ─────────────────────────────────────────────────────────────────────────────

export interface DataTableColumn<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortable?: boolean;
  align?: "left" | "right";
  /** Extra classes for both the header and body cells of this column. */
  className?: string;
}

export interface DataTableSort {
  key: string;
  dir: "asc" | "desc";
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSort,
  density,
  empty,
  stickyHeader = false,
  onRowClick,
  className,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  sort?: DataTableSort | null;
  onSort?: (key: string) => void;
  /** Override the workspace density for this one table. Almost nothing should:
   *  the setting is a workspace-level choice, not a per-table one. */
  density?: Density;
  /** Rendered (inside the container) when there are no rows. */
  empty: ReactNode;
  stickyHeader?: boolean;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  // Horizontal padding is CONSTANT. This used to switch `px-4 py-3` ↔
  // `px-3 py-1.5`, moving every column 4px inward on the way to Compact — so a
  // manager tightening the rows lost the horizontal position of everything
  // they were reading. globals.css states the rule verbatim.
  const resolved = useDensity().density;
  const active = density ?? resolved;
  const cellPad = CELL;

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full min-w-full border-collapse text-sm">
        <thead className={cn(stickyHeader && "sticky top-0 z-10")}>
          <tr className="border-b border-border/70 bg-surface">
            {columns.map((col) => {
              const active = sort?.key === col.key;
              const SortIcon = active
                ? sort?.dir === "asc"
                  ? ArrowUp
                  : ArrowDown
                : ArrowUpDown;
              return (
                <th
                  key={col.key}
                  scope="col"
                  aria-sort={
                    active ? (sort?.dir === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={cn(
                    "whitespace-nowrap text-[11px] font-bold uppercase tracking-wide text-muted-foreground",
                    cellPad,
                    col.align === "right" ? "text-right" : "text-left",
                    col.className,
                  )}
                >
                  {col.sortable && onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active ? "text-foreground" : "hover:text-foreground",
                      )}
                    >
                      {col.header}
                      <SortIcon className="h-3 w-3" aria-hidden />
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="p-0">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                // A clickable row with no keyboard path is a control only a
                // mouse can reach. `row` is the correct role for a focusable
                // table row, and Enter/Space are what a button would answer to.
                {...(onRowClick
                  ? {
                      role: "row" as const,
                      tabIndex: 0,
                      onKeyDown: (e: KeyboardEvent<HTMLTableRowElement>) => {
                        // Never swallow a key aimed at something INSIDE the row
                        // — a link, a button, a checkbox all answer to these.
                        if (e.target !== e.currentTarget) return;
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onRowClick(row);
                        }
                      },
                    }
                  : {})}
                className={cn(
                  // A minimum, never a fixed height: a genuinely tall cell (a
                  // wrapped address) may still grow, it just cannot be the only
                  // 90px row in a column of 40px ones.
                  ROW_MIN,
                  "align-middle transition-colors",
                  onRowClick &&
                    "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      cellPad,
                      col.align === "right" ? "text-right" : "text-left",
                      col.className,
                    )}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
