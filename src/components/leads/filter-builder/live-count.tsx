"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import type { FilterSpec } from "@/lib/leads/filter-spec";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// LiveCount — "N match", continuously, while the filter is being built.
//
// Debounced 400ms so typing a city name fires one request, not nine, and each
// new spec ABORTS the in-flight request — without that, a slow early count can
// land after a fast later one and show a stale number for the current filter.
// Demo-safe: the count route answers from the sample book without Supabase, and
// any failure renders an honest "—", never a fabricated zero.
// ─────────────────────────────────────────────────────────────────────────────

export function LiveCount({
  filter,
  className,
}: {
  filter: FilterSpec | null;
  className?: string;
}) {
  const [count, setCount] = React.useState<number | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  // Depend on the SERIALIZED spec: parents may rebuild an identical object each
  // render, and refetching on identity churn would defeat the debounce.
  const specJson = filter && filter.groups.length > 0 ? JSON.stringify(filter) : "";

  React.useEffect(() => {
    if (!specJson) {
      setCount(null);
      setLoading(false);
      setFailed(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/leads/filter/count", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: `{"filter":${specJson}}`,
          signal: ctrl.signal,
        });
        if (!res.ok) {
          // 400 = nothing valid in the spec (e.g. a number still being typed).
          setFailed(true);
          setCount(null);
        } else {
          const data = (await res.json()) as { count?: number };
          setCount(Number(data.count ?? 0));
          setFailed(false);
        }
      } catch {
        if (!ctrl.signal.aborted) setFailed(true);
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [specJson]);

  if (!specJson) return null;

  return (
    <span
      aria-live="polite"
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {loading && (
        <Loader2
          aria-label="Counting"
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
        />
      )}
      {failed && !loading ? (
        <span title="Count unavailable">—</span>
      ) : count !== null ? (
        <span className={cn(loading && "opacity-60")}>
          <span className="tabular font-semibold text-foreground">
            {count.toLocaleString()}
          </span>{" "}
          match
        </span>
      ) : (
        loading && <span>Counting…</span>
      )}
    </span>
  );
}
