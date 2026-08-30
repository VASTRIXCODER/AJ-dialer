"use client";

import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RecentCall } from "@/lib/db/metrics";
import { RecentCalls } from "./recent-calls";
import { TableSkeleton } from "@/components/shared/skeletons";

const PAGE = 50;

/**
 * Full, paginated call history — every logged call with its recording +
 * transcript, loaded in pages of 50. Reuses the RecentCalls table for rendering
 * (each row still opens the AI dashboard / manual detail with recording + summary).
 */
export function CallHistory() {
  const [calls, setCalls] = useState<RecentCall[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (offset: number) => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/calls/history?offset=${offset}&limit=${PAGE}`, {
        cache: "no-store",
      });
      const j = (await r.json()) as { calls?: RecentCall[]; hasMore?: boolean };
      const next = Array.isArray(j.calls) ? j.calls : [];
      setCalls((prev) => {
        if (offset === 0) return next;
        // Dedupe by id in case new calls shifted the window between pages.
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...next.filter((c) => !seen.has(c.id))];
      });
      setHasMore(Boolean(j.hasMore));
    } catch {
      setError("Couldn’t load call history.");
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);

  if (loaded && calls.length === 0) {
    return (
      <p className="p-8 text-center text-sm text-muted-foreground">
        {error || "No calls logged yet."}
      </p>
    );
  }

  return (
    <div>
      {calls.length > 0 ? (
        <RecentCalls calls={calls} />
      ) : (
        /* The grid keeps its shape while it loads instead of collapsing to a
           dot and jumping back. */
        <div className="p-4">
          <TableSkeleton rows={6} />
        </div>
      )}
      <div className="flex items-center justify-center gap-3 border-t border-border/60 p-4">
        {error && <span className="text-sm font-medium text-danger">{error}</span>}
        {hasMore ? (
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={loading}
            onClick={() => load(calls.length)}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Load more calls
          </Button>
        ) : (
          calls.length > 0 && (
            <span className="text-xs text-muted-foreground">
              All {calls.length} call{calls.length === 1 ? "" : "s"} loaded
            </span>
          )
        )}
      </div>
    </div>
  );
}
