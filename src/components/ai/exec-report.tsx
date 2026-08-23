"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  Lightbulb,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AiSourceBadge } from "@/components/ai/source-badge";
import { SpotlightCard } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import type { ExecutiveReport } from "@/lib/ai/types";
import { cn } from "@/lib/utils";

const priorityTone = {
  high: "danger",
  medium: "warning",
  low: "neutral",
} as const;

function Column({
  title,
  icon: Icon,
  items,
  tone,
}: {
  title: string;
  icon: typeof TrendingUp;
  items: string[];
  tone: string;
}) {
  return (
    <div>
      <p className={cn("flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide", tone)}>
        <Icon className="h-3.5 w-3.5" />
        {title}
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="text-sm leading-snug text-muted-foreground">
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AiExecReport() {
  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ExecutiveReport | null>(null);
  const [source, setSource] = useState<"claude" | "demo" | null>(null);
  const [sourceError, setSourceError] = useState<string | undefined>();

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/ai/report", { method: "POST" })
      .then((r) => r.json())
      .then((j: { data: ExecutiveReport; source: "claude" | "demo"; error?: string }) => {
        setReport(j.data);
        setSource(j.source);
        setSourceError(j.error);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SpotlightCard tilt={false} className="overflow-hidden p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <h3 className="font-semibold tracking-tight">AI executive briefing</h3>
            <p className="text-xs text-muted-foreground">
              Claude reads the floor metrics and tells you what to do next
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {source && <AiSourceBadge source={source} error={sourceError} />}
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            aria-label="Regenerate"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {loading || !report ? (
        <div className="mt-5 space-y-3">
          <div className="skeleton h-5 w-2/3 rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-full rounded" />
          <div className="skeleton h-3 w-4/5 rounded" />
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="skeleton h-24 rounded-xl" />
            <div className="skeleton h-24 rounded-xl" />
            <div className="skeleton h-24 rounded-xl" />
          </div>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
          className="mt-5 space-y-5"
        >
          <div>
            <p className="text-lg font-bold tracking-tight text-gradient-brand">
              {report.headline}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {report.narrative}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 border-t border-border/60 pt-5 sm:grid-cols-3">
            <Column title="Trends" icon={TrendingUp} items={report.trends} tone="text-success" />
            <Column title="Risks" icon={AlertTriangle} items={report.risks} tone="text-warning" />
            <Column
              title="Opportunities"
              icon={Lightbulb}
              items={report.opportunities}
              tone="text-primary"
            />
          </div>

          <div className="border-t border-border/60 pt-5">
            <p className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Recommended actions
            </p>
            <div className="space-y-2.5">
              {report.recommendations.map((r, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * 0.06 }}
                  className="flex items-start gap-3 rounded-xl bg-background/40 p-3 ring-1 ring-inset ring-border/50"
                >
                  <Badge tone={priorityTone[r.priority]} className="mt-0.5 shrink-0 capitalize">
                    {r.priority}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{r.title}</p>
                    <p className="text-xs text-muted-foreground">{r.detail}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </SpotlightCard>
  );
}
