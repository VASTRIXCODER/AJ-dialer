"use client";

import type { LucideIcon } from "lucide-react";
import { Circle } from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";

type Tone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger";

const toneDot: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/12 text-danger",
};

export interface TimelineDisplayItem {
  id: string;
  /** ISO timestamp — rendered as relative time, absolute on hover. */
  at: string;
  icon?: LucideIcon;
  title: React.ReactNode;
  detail?: React.ReactNode;
  tone?: Tone;
}

/**
 * Vertical activity timeline: an icon column joined by a connector line, each
 * entry titled with a relative timestamp (the absolute time lives in the title
 * attribute — hover/long-press reveals it). Purely presentational; feeds come
 * from lead-timeline's merge.
 */
export function Timeline({
  items,
  className,
}: {
  items: TimelineDisplayItem[];
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <ol className={cn("space-y-0", className)}>
      {items.map((item, i) => {
        const Icon = item.icon ?? Circle;
        const tone = item.tone ?? "neutral";
        const last = i === items.length - 1;
        const t = Date.parse(item.at);
        const absolute = Number.isNaN(t) ? item.at : new Date(t).toLocaleString();
        return (
          <li key={item.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Connector line — stops at the final dot. */}
            {!last && (
              <span
                aria-hidden
                className="absolute left-[13px] top-7 h-[calc(100%-1.25rem)] w-px bg-border"
              />
            )}
            <span
              className={cn(
                "relative z-[1] mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
                toneDot[tone],
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-semibold leading-snug">{item.title}</p>
                <time
                  dateTime={item.at}
                  title={absolute}
                  className="shrink-0 text-xs text-muted-foreground tabular"
                >
                  {Number.isNaN(t) ? "" : relativeTime(item.at)}
                </time>
              </div>
              {item.detail && (
                <p className="mt-0.5 break-words text-xs leading-relaxed text-muted-foreground">
                  {item.detail}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
