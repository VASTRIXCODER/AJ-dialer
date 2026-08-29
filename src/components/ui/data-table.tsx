"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { Density } from "./density-toggle";

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
  density = "comfortable",
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
  density?: Density;
  /** Rendered (inside the container) when there are no rows. */
  empty: ReactNode;
  stickyHeader?: boolean;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  const cellPad = density === "compact" ? "px-3 py-1.5" : "px-4 py-3";

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
                className={cn(
                  "transition-colors",
                  onRowClick && "cursor-pointer hover:bg-muted/50",
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
