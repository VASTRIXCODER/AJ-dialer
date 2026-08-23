"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CalendarClock,
  Lightbulb,
  Quote,
  Sparkles,
  Target,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AiSourceBadge } from "@/components/ai/source-badge";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { LeadBriefing } from "@/lib/ai/types";
import { cn, formatCurrency } from "@/lib/utils";

type State = {
  loading: boolean;
  data?: LeadBriefing;
  source?: "claude" | "demo";
  /** Why the server fell back to the simulator, when it did. */
  sourceError?: string;
  error?: boolean;
};

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-background/40 p-2.5 text-center ring-1 ring-inset ring-border/50">
      <p className={cn("text-lg font-bold tabular", accent && "text-primary")}>
        {value}
      </p>
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold tabular">{Math.round(value)}%</span>
      </div>
      <Progress value={value} className="h-1.5" />
    </div>
  );
}

type BriefingPayload = {
  data: LeadBriefing;
  source: "claude" | "demo";
  error?: string;
};

// ── Briefing cache + prefetch ────────────────────────────────────────────────
// A live briefing is a real model call and takes seconds — long enough that a
// rep who dispositions and advances sits watching a skeleton before every dial.
// The queue already knows who is next, so the next lead's briefing is fetched
// while the rep is still on the current call and is simply THERE when they get
// to it.
//
// In-flight promises are cached (not just results), so a prefetch and the render
// that catches up to it share one request rather than racing to make two.
const cache = new Map<string, Promise<BriefingPayload>>();
/** Bounded so a long dialing session can't grow this without limit. */
const MAX_CACHED = 60;

function load(leadId: string): Promise<BriefingPayload> {
  const hit = cache.get(leadId);
  if (hit) return hit;
  const p = fetch("/api/ai/briefing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ leadId }),
  })
    .then((r) => r.json() as Promise<BriefingPayload>)
    .then((j) => {
      if (!j?.data) throw new Error("no briefing");
      return j;
    })
    .catch((e) => {
      // Never cache a failure — the next render (or a retry) must be able to
      // ask again rather than being pinned to one bad response forever.
      cache.delete(leadId);
      throw e;
    });
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(leadId, p);
  return p;
}

/**
 * Warm the briefing for a lead the rep hasn't reached yet. Safe to call
 * repeatedly: an in-flight or completed briefing is reused, not re-requested.
 */
export function prefetchBriefing(leadId: string | null | undefined): void {
  if (leadId) void load(leadId).catch(() => {});
}

export function AiBriefing({ leadId }: { leadId: string | null }) {
  const vocab = useVocabulary();
  const [state, setState] = useState<State>({ loading: false });

  useEffect(() => {
    if (!leadId) {
      setState({ loading: false });
      return;
    }
    let alive = true;
    // Already warmed by the prefetch? Render immediately instead of flashing a
    // skeleton for a briefing we're holding.
    setState({ loading: !cache.has(leadId) });
    load(leadId)
      .then((j) => {
        if (!alive) return;
        setState({
          loading: false,
          data: j.data,
          source: j.source,
          sourceError: j.error,
        });
      })
      .catch(() => {
        if (alive) setState({ loading: false, error: true });
      });
    return () => {
      alive = false;
    };
  }, [leadId]);

  if (!leadId) {
    return (
      <div className="rounded-xl border border-accent/25 bg-accent-soft/40 p-3">
        <div className="flex items-center gap-2 text-accent">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-semibold">AI briefing</span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Select or dial a {vocab.leadNoun} for an instant briefing.
        </p>
      </div>
    );
  }

  if (state.loading || (!state.data && !state.error)) {
    return (
      <div className="space-y-2.5 rounded-xl border border-border/60 p-3">
        <div className="flex items-center gap-2 text-accent">
          <Sparkles className="h-4 w-4 animate-pulse" />
          <span className="text-sm font-semibold">Preparing your briefing…</span>
        </div>
        <div className="skeleton h-3 w-full rounded" />
        <div className="skeleton h-3 w-4/5 rounded" />
        <div className="grid grid-cols-3 gap-2 pt-1">
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
        </div>
      </div>
    );
  }

  if (state.error || !state.data) {
    return (
      <div className="rounded-xl border border-border/60 p-3 text-xs text-muted-foreground">
        Couldn’t generate a briefing right now.
      </div>
    );
  }

  const b = state.data;
  const section = (i: number) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: i * 0.05, duration: 0.4, ease: [0.22, 1, 0.36, 1] as const },
  });

  return (
    <div className="space-y-3.5">
      <motion.div {...section(0)} className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-accent">
          <Sparkles className="h-4 w-4" />
          AI briefing
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-muted-foreground tabular">
            {b.confidence}% conf.
          </span>
          {state.source && (
            <AiSourceBadge source={state.source} error={state.sourceError} />
          )}
        </div>
      </motion.div>

      <motion.p {...section(1)} className="text-xs leading-relaxed text-muted-foreground">
        {b.summary}
      </motion.p>

      <motion.div {...section(2)} className="grid grid-cols-3 gap-2">
        <Stat label="Priority" value={`${b.priorityScore}`} accent />
        <Stat label="Appt prob" value={`${b.appointmentProbability}%`} />
        <Stat label="Opportunity" value={formatCurrency(b.estimatedValue)} />
      </motion.div>

      <motion.div {...section(3)} className="space-y-2">
        <Bar label="Contact probability" value={b.contactProbability} />
        <Bar label="Qualification probability" value={b.qualificationProbability} />
      </motion.div>

      <motion.div {...section(4)} className="flex flex-wrap gap-1.5">
        <Badge tone="neutral">{b.personality}</Badge>
        <Badge tone="neutral">{b.communicationStyle}</Badge>
      </motion.div>

      <motion.div
        {...section(5)}
        className="rounded-xl border border-primary/25 bg-primary-soft/40 p-3"
      >
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-primary">
          <Quote className="h-3.5 w-3.5" />
          Opening line
        </p>
        <p className="mt-1 text-xs leading-relaxed">{b.openingLine}</p>
      </motion.div>

      <motion.div {...section(6)} className="space-y-1.5">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          <Target className="h-3.5 w-3.5" />
          Strategy
        </p>
        <p className="text-xs leading-relaxed text-muted-foreground">{b.strategy}</p>
      </motion.div>

      {b.objections.length > 0 && (
        <motion.div {...section(7)} className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            Likely objections
          </p>
          <ul className="space-y-1">
            {b.objections.map((o, i) => (
              <li key={i} className="text-xs italic text-muted-foreground">
                {o}
              </li>
            ))}
          </ul>
        </motion.div>
      )}

      {b.painPoints.length > 0 && (
        <motion.div {...section(8)} className="flex flex-wrap gap-1.5">
          {b.painPoints.map((p, i) => (
            <span
              key={i}
              className="rounded-lg bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground"
            >
              {p}
            </span>
          ))}
        </motion.div>
      )}

      <motion.div
        {...section(9)}
        className="flex items-center gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs"
      >
        <CalendarClock className="h-3.5 w-3.5 shrink-0 text-accent" />
        <span className="text-muted-foreground">Best callback</span>
        <span className="ml-auto font-semibold">{b.bestCallback}</span>
      </motion.div>

      <motion.div
        {...section(10)}
        className="flex items-start gap-2 rounded-xl border border-dashed border-border/70 p-2.5"
      >
        <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground">Close: </span>
          {b.closingStrategy}
        </p>
      </motion.div>
    </div>
  );
}
