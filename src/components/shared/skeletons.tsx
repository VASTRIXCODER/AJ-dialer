import { cn } from "@/lib/utils";

/**
 * Route-level loading skeletons. Each piece leans on the `.skeleton` shimmer
 * utility from globals.css (token-based, stilled by prefers-reduced-motion),
 * so light/dark and motion preferences come for free.
 */

/** Base shimmer block. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("skeleton rounded-lg", className)} />;
}

/**
 * Mirrors PageHeader's geometry (title + description, optional action pill).
 * Also carries the single screen-reader announcement for the loading page.
 */
export function PageHeaderSkeleton({ action = false }: { action?: boolean }) {
  return (
    <div
      aria-busy="true"
      className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
    >
      <span role="status" className="sr-only">
        Loading…
      </span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {action && <Skeleton className="h-9 w-32 rounded-xl" />}
    </div>
  );
}

/** A bordered card shell matching `Card` (rounded-2xl surface-glass). */
export function CardSkeleton({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-2xl border border-border/60 surface-glass p-5 sm:p-6",
        className,
      )}
    >
      {children ?? (
        <div className="space-y-3">
          <Skeleton className="h-5 w-40 max-w-[60%]" />
          <Skeleton className="h-3.5 w-64 max-w-[85%]" />
          <Skeleton className="mt-4 h-32 w-full rounded-xl" />
        </div>
      )}
    </div>
  );
}

const METRIC_COLS: Record<number, string> = {
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "sm:grid-cols-3 lg:grid-cols-5",
  6: "sm:grid-cols-3 lg:grid-cols-6",
};

/** Mirrors the MetricCard KPI row (`grid grid-cols-2 gap-4 lg:grid-cols-4`). */
export function MetricRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div
      aria-hidden="true"
      className={cn("grid grid-cols-2 gap-4", METRIC_COLS[count] ?? METRIC_COLS[4])}
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border/60 surface-glass p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-3.5 w-16" />
            </div>
            <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A table/list card: header bar + N rows of avatar circle + two text bars. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div
      aria-hidden="true"
      className="overflow-hidden rounded-2xl border border-border/60 surface-glass"
    >
      <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-9 w-44 max-w-[40%] rounded-xl" />
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3.5">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-40 max-w-[45%]" />
              <Skeleton className="h-3 w-64 max-w-[70%]" />
            </div>
            <Skeleton className="hidden h-3.5 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

const GRID_COLS: Record<number, string> = {
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 xl:grid-cols-3",
  4: "sm:grid-cols-2 xl:grid-cols-4",
};

/** A grid of card blocks (campaign cards, board columns, …). */
export function CardGridSkeleton({
  cards = 6,
  cols = 3,
}: {
  cards?: number;
  cols?: 2 | 3 | 4;
}) {
  return (
    <div aria-hidden="true" className={cn("grid grid-cols-1 gap-4", GRID_COLS[cols])}>
      {Array.from({ length: cards }).map((_, i) => (
        <div
          key={i}
          className="space-y-3 rounded-2xl border border-border/60 surface-glass p-5"
        >
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="mt-4 h-20 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}
