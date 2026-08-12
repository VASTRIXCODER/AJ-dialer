"use client";

import { motion } from "framer-motion";
import { CheckCircle2, ListChecks, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { CallSummary } from "@/lib/ai/types";
import { outcomeConfig } from "@/lib/status";
import { cn } from "@/lib/utils";

type State = {
  loading: boolean;
  data?: CallSummary;
  source?: "claude" | "demo";
};

export function AiCallSummary({
  leadId,
  notes,
  durationSec,
}: {
  leadId: string | null;
  /** The rep's in-call notes — real evidence for the documentation. */
  notes?: string;
  durationSec?: number;
}) {
  const [state, setState] = useState<State>({ loading: true });
  // Snapshot the evidence once: the summary documents the call as it ended,
  // and re-fetching because a prop identity wobbled would double the AI spend.
  const evidenceRef = useRef({ notes, durationSec });

  useEffect(() => {
    if (!leadId) {
      setState({ loading: false });
      return;
    }
    setState({ loading: true });
    const ctrl = new AbortController();
    fetch("/api/ai/summary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId, ...evidenceRef.current }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((j: { data: CallSummary; source: "claude" | "demo" }) =>
        setState({ loading: false, data: j.data, source: j.source }),
      )
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ loading: false });
      });
    return () => ctrl.abort();
  }, [leadId]);

  if (!leadId) return null;

  return (
    <div className="rounded-xl border border-accent/25 bg-accent-soft/30 p-3 text-left">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-accent">
          <Sparkles className={cn("h-4 w-4", state.loading && "animate-pulse")} />
          {state.loading ? "Documenting this call…" : "AI wrote your notes"}
        </span>
        {state.source && !state.loading && (
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              state.source === "claude"
                ? "bg-accent-soft text-accent"
                : "bg-muted text-muted-foreground",
            )}
          >
            {state.source === "claude" ? "Claude" : "Demo AI"}
          </span>
        )}
      </div>

      {state.loading ? (
        <div className="mt-2 space-y-2">
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-4/5 rounded" />
        </div>
      ) : state.data ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="mt-2 space-y-3"
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            {state.data.executiveSummary}
          </p>

          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Claude suggests</span>
            <Badge tone={outcomeConfig[state.data.recommendedOutcome]?.tone ?? "neutral"}>
              {outcomeConfig[state.data.recommendedOutcome]?.label ??
                state.data.recommendedOutcome.replace(/_/g, " ")}
            </Badge>
          </div>

          {state.data.actionItems.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <ListChecks className="h-3.5 w-3.5" />
                Action items
              </p>
              <ul className="mt-1 space-y-1">
                {state.data.actionItems.map((a, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-success" />
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </motion.div>
      ) : null}
    </div>
  );
}
