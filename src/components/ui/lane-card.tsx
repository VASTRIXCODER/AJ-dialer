"use client";

import { motion, useReducedMotion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// LaneCard — the generic "one live thing on one line" primitive (E4). The
// parallel dialer renders one per ringing lane; the AI session renders one per
// launched call. Purely presentational: header (who), statusPill + timer
// (what/how long — the caller supplies both so this card never invents state),
// body, optional footer. `focused` marks THE lane that matters right now (the
// answered lane) with a ring + a slight scale — the scale is a transform, so
// it's gated on prefers-reduced-motion; the ring is not motion and stays.
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
  /** The lane the rep should be looking at — ring + slight scale (motion-aware). */
  focused?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout={!reduce}
      initial={false}
      animate={{ scale: focused && !reduce ? 1.015 : 1 }}
      transition={{ type: "spring", stiffness: 320, damping: 28 }}
      className={cn(
        "rounded-2xl border",
        compact ? "px-3 py-2" : "p-3.5",
        focused
          ? "border-primary/40 bg-card shadow-lift ring-2 ring-primary/25"
          : "border-border/70 bg-surface/50 shadow-soft backdrop-blur",
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
    </motion.div>
  );
}
