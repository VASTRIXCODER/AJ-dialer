"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AISource } from "@/lib/ai/types";

/**
 * "Claude" vs "Demo AI" — the one badge every AI surface uses.
 *
 * Four screens had their own copy of this, and none of them could say WHY a
 * workspace was seeing simulated intelligence. That made a missing key, a
 * rejected key and a bad AI_MODEL indistinguishable from "this feature is just
 * like that", so nobody ever went and fixed it. The reason now rides along with
 * the result (see runAI in src/lib/ai/claude.ts) and is surfaced here.
 */
export function AiSourceBadge({
  source,
  error,
  className,
}: {
  source: AISource;
  /** Why it fell back, when it did. Shown on hover/focus. */
  error?: string;
  className?: string;
}) {
  const live = source === "claude";
  const reason = !live ? error : undefined;
  return (
    <span
      // A native title is deliberate: this must work on a hover, a long-press
      // and a screen reader without dragging a popover library into a badge.
      title={
        reason
          ? `Showing simulated intelligence — ${reason}`
          : live
            ? "Generated live by Claude."
            : "Showing simulated intelligence — connect an Anthropic API key for live analysis."
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide",
        live
          ? "bg-accent-soft text-accent"
          : reason
            ? "cursor-help bg-warning/12 text-warning"
            : "bg-muted text-muted-foreground",
        className,
      )}
    >
      <Sparkles className="h-3 w-3" />
      {live ? "Claude" : "Demo AI"}
    </span>
  );
}
