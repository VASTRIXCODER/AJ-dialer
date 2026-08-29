"use client";

import { Check, Flame, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn, formatPhone, relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Hot queue (P2.6-lite): open signals, most severe first — every row says WHY
// it's hot (type + evidence + freshness) and what to do (open the lead,
// acknowledge, dismiss). The engine's escalations land here; reps see their
// own opportunities' signals, supervisors the org's (server-scoped).
// ─────────────────────────────────────────────────────────────────────────────

interface SignalRow {
  id: string;
  type: string;
  severity: number;
  evidence: Record<string, unknown>;
  detectedAt: string;
  seenCount: number;
  acknowledged: boolean;
  leadId: string | null;
  leadName: string | null;
  phone: string | null;
  stage: string | null;
}

function label(type: string): string {
  return type
    .replace(/^escalation:/, "")
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

export function HotQueue() {
  const [signals, setSignals] = useState<SignalRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/signals", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as { signals: SignalRow[] };
      setSignals(j.signals ?? []);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (id: string, action: "acknowledge" | "dismiss") => {
    // Optimistic — a dismissed row leaves immediately; a failed PATCH is
    // rescued by the next poll.
    setSignals((s) =>
      action === "dismiss"
        ? s.filter((x) => x.id !== id)
        : s.map((x) => (x.id === id ? { ...x, acknowledged: true } : x)),
    );
    fetch("/api/signals", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, action }),
      keepalive: true,
    }).catch(() => {});
  };

  // An empty queue is GOOD news and doesn't deserve a whole card of chrome.
  if (loaded && signals.length === 0) return null;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/15 text-warning">
          <Flame className="h-4 w-4" />
        </span>
        <div>
          <h3 className="font-semibold">Hot signals</h3>
          <p className="text-xs text-muted-foreground">
            Needs attention now — most severe first, every row explains itself.
          </p>
        </div>
      </div>
      <div className="mt-3 space-y-2">
        {!loaded ? (
          <div className="skeleton h-12 rounded-xl" />
        ) : (
          signals.slice(0, 8).map((s) => (
            <div
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-surface/50 px-3.5 py-2.5",
                s.acknowledged && "opacity-70",
              )}
            >
              <Badge tone={s.severity >= 4 ? "danger" : "warning"}>{label(s.type)}</Badge>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {s.leadId ? (
                    <Link
                      href={`/leads?lead=${encodeURIComponent(s.leadId)}`}
                      className="hover:underline"
                    >
                      {s.leadName || (s.phone ? formatPhone(s.phone) : "Unknown contact")}
                    </Link>
                  ) : (
                    s.leadName || "Unknown contact"
                  )}
                  {s.stage ? (
                    <span className="ml-2 text-xs text-muted-foreground capitalize">
                      {s.stage.replace(/_/g, " ")}
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {relativeTime(s.detectedAt)}
                  {s.seenCount > 1 ? ` · seen ${s.seenCount}×` : ""}
                  {typeof s.evidence.reason === "string"
                    ? ` · ${String(s.evidence.reason).replace(/_/g, " ")}`
                    : ""}
                </p>
              </div>
              {!s.acknowledged && (
                <button
                  type="button"
                  title="Acknowledge — I'm on it"
                  aria-label="Acknowledge signal"
                  onClick={() => act(s.id, "acknowledge")}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-success/10 hover:text-success"
                >
                  <Check className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                title="Dismiss"
                aria-label="Dismiss signal"
                onClick={() => act(s.id, "dismiss")}
                className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
