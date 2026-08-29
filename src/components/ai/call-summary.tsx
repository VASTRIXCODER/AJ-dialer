"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AiSourceBadge } from "@/components/ai/source-badge";
import { Badge } from "@/components/ui/badge";
import type { WrapupSuggestion } from "@/lib/ai/types";
import { outcomeConfig } from "@/lib/status";
import type { CallOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

type State = {
  loading: boolean;
  data?: WrapupSuggestion;
  source?: "claude" | "demo";
  sourceError?: string;
};

/**
 * The wrap-up copilot — AI disposition for manual dialing.
 *
 * Was "AiCallSummary": an auto-firing per-call summary document that was never
 * persisted and whose recommendedOutcome badge was display-only. Two things
 * changed with the appointment-only summary policy:
 *  • persisted summaries are generated server-side after the save (and only
 *    for booked appointments) — the wrap-up no longer spends a Claude call
 *    writing a throwaway document;
 *  • the suggestion is now ACTIONABLE and org-taxonomy-aware: one click on the
 *    suggested chip files that disposition through the exact same handler as
 *    the wrap-up grid. It refreshes itself when the rep's notes settle, so the
 *    suggestion follows the evidence instead of snapshotting empty notes at
 *    mount.
 */
export function AiCallSummary({
  leadId,
  notes,
  durationSec,
  allowedKeys,
  onPick,
}: {
  leadId: string | null;
  /** The rep's in-call notes — the evidence behind the suggestion. */
  notes?: string;
  durationSec?: number;
  /** Campaign disposition subset, when dialing under one. */
  allowedKeys?: string[];
  /** File the suggested disposition — same contract as OutcomeGrid.onSelect. */
  onPick?: (outcome: CallOutcome, dispositionKey?: string) => void;
}) {
  const [state, setState] = useState<State>({ loading: true });
  const lastFetchedNotes = useRef<string | null>(null);
  const allowedRef = useRef(allowedKeys);
  allowedRef.current = allowedKeys;

  useEffect(() => {
    if (!leadId) {
      setState({ loading: false });
      return;
    }
    const current = notes ?? "";
    // First fetch fires immediately; afterwards only when the notes actually
    // changed, on a settle delay — one request per pause in typing, not per
    // keystroke, and never a re-fetch because a prop identity wobbled.
    const isFirst = lastFetchedNotes.current === null;
    if (!isFirst && lastFetchedNotes.current === current) return;

    const ctrl = new AbortController();
    const run = () => {
      lastFetchedNotes.current = current;
      setState((s) => ({ ...s, loading: true }));
      fetch("/api/ai/wrapup-suggest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId,
          notes: current || undefined,
          durationSec,
          allowedKeys: allowedRef.current,
        }),
        signal: ctrl.signal,
      })
        .then((r) => r.json())
        .then(
          (j: { data?: WrapupSuggestion; source?: "claude" | "demo"; error?: string }) =>
            setState({
              loading: false,
              data: j.data,
              source: j.source,
              sourceError: j.error,
            }),
        )
        .catch(() => {
          if (!ctrl.signal.aborted) setState({ loading: false });
        });
    };
    if (isFirst) {
      run();
      return () => ctrl.abort();
    }
    const t = setTimeout(run, 2500);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
    // durationSec deliberately omitted: it's frozen once wrap-up shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, notes]);

  if (!leadId) return null;

  const s = state.data;
  const suggestion = s?.recommendedKey ? s : null;
  const tone = suggestion
    ? (outcomeConfig[suggestion.recommendedOutcome]?.tone ?? "neutral")
    : "neutral";

  return (
    <div className="rounded-xl border border-accent/25 bg-accent-soft/30 p-3 text-left">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-accent">
          <Sparkles className={cn("h-4 w-4", state.loading && "animate-pulse")} />
          {state.loading ? "Reading this call…" : "AI disposition"}
        </span>
        {state.source && !state.loading && (
          <AiSourceBadge source={state.source} error={state.sourceError} />
        )}
      </div>

      {state.loading ? (
        <div className="mt-2 space-y-2">
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-8 w-2/3 rounded-lg" />
        </div>
      ) : s ? (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="mt-2 space-y-2.5"
        >
          {s.quickSummary && (
            <p className="text-xs leading-relaxed text-muted-foreground">{s.quickSummary}</p>
          )}

          {suggestion ? (
            <div>
              <button
                type="button"
                onClick={() =>
                  onPick?.(suggestion.recommendedOutcome, suggestion.recommendedKey)
                }
                disabled={!onPick}
                title={
                  onPick
                    ? `File this call as “${suggestion.recommendedLabel}”`
                    : undefined
                }
                className="inline-flex items-center gap-2 rounded-lg border border-accent/40 bg-background px-3 py-2 text-sm font-semibold transition-colors enabled:hover:border-accent enabled:hover:bg-accent-soft/60 disabled:cursor-default"
              >
                <span className="text-muted-foreground">Suggests</span>
                <Badge tone={tone}>{suggestion.recommendedLabel}</Badge>
                <span className="tabular text-xs text-muted-foreground">
                  {Math.round(suggestion.confidence * 100)}%
                </span>
              </button>
              {suggestion.rationale && (
                <p className="mt-1.5 text-[11px] text-muted-foreground/80">
                  {suggestion.rationale} — your click files it; nothing applies on its own.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Not enough evidence for a suggestion — add a note or pick below.
            </p>
          )}
        </motion.div>
      ) : null}
    </div>
  );
}
