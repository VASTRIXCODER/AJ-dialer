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
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { LeadBriefing } from "@/lib/ai/types";
import { cn, formatCurrency } from "@/lib/utils";

type State = {
  loading: boolean;
  data?: LeadBriefing;
  source?: "claude" | "demo";
  error?: boolean;
};

function SourceBadge({ source }: { source: "claude" | "demo" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
        source === "claude"
          ? "bg-accent-soft text-accent"
          : "bg-muted text-muted-foreground",
      )}
    >
      <Sparkles className="h-3 w-3" />
      {source === "claude" ? "Claude" : "Demo AI"}
    </span>
  );
}

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

export function AiBriefing({ leadId }: { leadId: string | null }) {
  const [state, setState] = useState<State>({ loading: false });

  useEffect(() => {
    if (!leadId) {
      setState({ loading: false });
      return;
    }
    setState({ loading: true });
    const ctrl = new AbortController();
    fetch("/api/ai/briefing", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ leadId }),
      signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((j: { data: LeadBriefing; source: "claude" | "demo" }) =>
        setState({ loading: false, data: j.data, source: j.source }),
      )
      .catch(() => {
        if (!ctrl.signal.aborted) setState({ loading: false, error: true });
      });
    return () => ctrl.abort();
  }, [leadId]);

  if (!leadId) {
    return (
      <div className="rounded-xl border border-accent/25 bg-accent-soft/40 p-3">
        <div className="flex items-center gap-2 text-accent">
          <Sparkles className="h-4 w-4" />
          <span className="text-sm font-semibold">AI briefing</span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          Select or dial a homeowner and Claude will brief you instantly.
        </p>
      </div>
    );
  }

  if (state.loading || (!state.data && !state.error)) {
    return (
      <div className="space-y-2.5 rounded-xl border border-border/60 p-3">
        <div className="flex items-center gap-2 text-accent">
          <Sparkles className="h-4 w-4 animate-pulse" />
          <span className="text-sm font-semibold">Briefing the homeowner…</span>
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
          {state.source && <SourceBadge source={state.source} />}
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
