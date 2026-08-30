"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { Tooltip } from "@/components/ui/tooltip";
import { cn, formatNumber } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// CampaignFunnel — the accurate, mutually-exclusive state buckets from
// app_campaign_funnel, rendered as one segmented bar plus per-stage rows.
// EVERY number is a link: the server pre-encodes each stage's FilterSpec into
// /leads?f=… (stageFilter in src/lib/campaign-policy.ts), so clicking a
// segment opens exactly (or, for call-derived buckets, as close as lead-side
// filters can get — the ⓘ tooltip says so) the rows behind the count.
// ─────────────────────────────────────────────────────────────────────────────

export interface FunnelStageView {
  key: string;
  label: string;
  description: string;
  /** Set when the drill filter only approximates the call-derived bucket. */
  approximate?: string;
  count: number;
  href: string;
}

/** Stage → bar/dot color. Tokens only — both themes get intentional colors. */
const STAGE_COLOR: Record<string, string> = {
  eligible: "bg-accent",
  assigned: "bg-chart-3",
  attempted: "bg-chart-2",
  connected: "bg-primary",
  callback: "bg-warning",
  appointment: "bg-success",
  converted: "bg-chart-5",
  exhausted: "bg-muted-foreground/50",
  dnc: "bg-danger",
  excluded: "bg-muted-foreground/25",
};

export function CampaignFunnel({
  stages,
  total,
}: {
  stages: FunnelStageView[];
  total: number;
}) {
  if (total === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No leads assigned yet — the funnel fills in as this campaign gets an audience.
      </p>
    );
  }
  const present = stages.filter((s) => s.count > 0);
  return (
    <div className="space-y-4">
      {/* The segmented bar — one flex row, each segment sized by share. */}
      <div
        className="flex h-3.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Funnel of ${formatNumber(total)} leads across ${present.length} stages`}
      >
        {present.map((s) => (
          <Link
            key={s.key}
            href={s.href}
            aria-label={`${s.label}: ${formatNumber(s.count)} — view in Leads`}
            title={`${s.label} · ${formatNumber(s.count)}`}
            className={cn(
              "block h-full transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              STAGE_COLOR[s.key] ?? "bg-muted-foreground/40",
            )}
            style={{
              width: `${(s.count / total) * 100}%`,
              // Tiny-but-present stages stay clickable.
              minWidth: 8,
            }}
          />
        ))}
      </div>

      {/* Per-stage rows — every count drills into /leads?f=… */}
      <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {stages.map((s) => {
          const pct = total > 0 ? Math.round((s.count / total) * 1000) / 10 : 0;
          return (
            <Link
              key={s.key}
              href={s.href}
              className="group flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-2.5 w-2.5 shrink-0 rounded-full",
                  STAGE_COLOR[s.key] ?? "bg-muted-foreground/40",
                )}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium group-hover:text-foreground">
                {s.label}
              </span>
              {s.approximate && (
                <Tooltip content={s.approximate}>
                  <span
                    tabIndex={0}
                    aria-label={`${s.label} drilldown note`}
                    className="inline-flex text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </span>
                </Tooltip>
              )}
              <span className="text-sm font-semibold tabular">{formatNumber(s.count)}</span>
              <span className="w-12 text-right text-xs text-muted-foreground tabular">
                {pct}%
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
