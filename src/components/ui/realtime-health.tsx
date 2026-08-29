"use client";

import { Tooltip } from "@/components/ui/tooltip";
import type { ChannelHealth } from "@/lib/realtime/use-org-channel";
import { cn, relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The realtime connection pill. Presentational only — callers own the channel
// subscription and hand in its health. Honest by design: "Live" means the push
// pipe is actually joined; anything else says so plainly, because every screen
// keeps a poll fallback and the pill is how a supervisor knows which mode
// they're looking at (instant vs. up-to-a-minute-old).
// ─────────────────────────────────────────────────────────────────────────────

const META: Record<
  ChannelHealth,
  { label: string; dotClass: string; textClass: string; explain: string }
> = {
  live: {
    label: "Live",
    dotClass: "bg-success",
    textClass: "text-success",
    explain: "Connected — calls and statuses update the instant they change.",
  },
  connecting: {
    label: "Connecting",
    dotClass: "bg-warning",
    textClass: "text-warning",
    explain: "Opening the live connection — updates arrive by refresh until it's up.",
  },
  reconnecting: {
    label: "Reconnecting",
    dotClass: "bg-warning",
    textClass: "text-warning",
    explain:
      "The live connection dropped and is being re-established. Data still refreshes on a timer meanwhile.",
  },
  unavailable: {
    label: "Offline",
    dotClass: "bg-muted-foreground/50",
    textClass: "text-muted-foreground",
    explain:
      "Live updates aren't available in this setup — this screen refreshes on a timer instead.",
  },
};

export function RealtimeHealth({
  health,
  lastEventAt,
  className,
}: {
  health: ChannelHealth;
  /** ms epoch of the last event received — shown in the tooltip when known. */
  lastEventAt?: number | null;
  className?: string;
}) {
  const meta = META[health];
  const tip =
    lastEventAt && health === "live"
      ? `${meta.explain} Last update ${relativeTime(new Date(lastEventAt).toISOString())}.`
      : meta.explain;

  return (
    <Tooltip content={tip}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide",
          meta.textClass,
          className,
        )}
      >
        <span className="relative flex h-2 w-2">
          {health === "live" && (
            <span
              className={cn(
                "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 motion-reduce:hidden",
                meta.dotClass,
              )}
            />
          )}
          <span className={cn("relative inline-flex h-2 w-2 rounded-full", meta.dotClass)} />
        </span>
        {meta.label}
      </span>
    </Tooltip>
  );
}
