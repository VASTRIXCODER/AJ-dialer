"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// LaneCard — the generic "one live thing on one line" primitive (E4). The
// parallel dialer renders one per ringing lane; the AI session renders one per
// launched call. Purely presentational: header (who), statusPill + timer
// (what/how long — the caller supplies both so this card never invents state),
// body, optional footer.
//
// `focused` marks THE lane that matters right now — the answered one — with a
// ring and a tonal step. It used to also scale to 1.015 with a spring and carry
// framer's `layout`, so on a parallel round the losing lanes re-flowed and
// sprang underneath the live cockpit while the rep was talking to somebody. A
// ring is not motion; a scale is. The lanes each show a name, a number and a
// running timer, which makes this an Instrument surface.
// ─────────────────────────────────────────────────────────────────────────────

export function LaneCard({
  header,
  statusPill,
  timer,
  body,
  footer,
  focused = false,
  compact = false,
  className,
}: {
  header: ReactNode;
  statusPill?: ReactNode;
  timer?: ReactNode;
  body?: ReactNode;
  footer?: ReactNode;
  /** The lane the rep should be looking at — ring and tone, never motion. */
  focused?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border transition-colors duration-[var(--dur-state)]",
        compact ? "px-3 py-2" : "p-3.5",
        focused
          ? "border-primary/40 bg-card shadow-2 ring-2 ring-primary/25"
          : "border-border/70 bg-surface shadow-1",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{header}</div>
        {(statusPill || timer) && (
          <div className="flex shrink-0 items-center gap-1.5">
            {statusPill}
            {timer}
          </div>
        )}
      </div>
      {body != null && <div className={compact ? "mt-1.5" : "mt-2.5"}>{body}</div>}
      {footer != null && (
        <div className={cn("border-t border-border/60", compact ? "mt-1.5 pt-1.5" : "mt-2.5 pt-2.5")}>
          {footer}
        </div>
      )}
    </div>
  );
}
