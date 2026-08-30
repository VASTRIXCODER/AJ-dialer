"use client";

import { Phone, RotateCcw } from "lucide-react";
import type { CallerIdInfo } from "@/lib/use-dialer";
import { cn, formatPhone } from "@/lib/utils";

/**
 * Session-bar control for the outbound caller-ID pool: one toggle pill per
 * number. Rotation only cycles among the numbers left ON — toggling every
 * number but one off effectively pins the dialer to it. At least one number
 * must stay on, so the last remaining one is shown but not clickable. The
 * server re-validates the excluded set against the live pool on every dial —
 * this component only ever proposes a choice.
 */
export function CallerIdPicker({
  pool,
  rotateEvery,
  excludedCallerIds,
  active,
  disabled,
  onToggle,
}: {
  /** The org's effective caller-ID pool (resolved server-side). */
  pool: string[];
  /** Calls per number before rotation advances to the next enabled one. */
  rotateEvery: number;
  /** Numbers the rep has toggled off. */
  excludedCallerIds: string[];
  /** What the LAST placed call used. Not a prediction of the next one: with
   *  the default rotateEvery of 1 the next call is a different number every
   *  time, and an unlabelled marker sitting on the previous number read as
   *  "this is the one you are about to dial from". */
  active: CallerIdInfo | null;
  /** True while a call is in flight — toggling mid-call is a no-op. */
  disabled: boolean;
  onToggle: (callerId: string) => void;
}) {
  // Nothing to choose between — a 0-or-1-number pool has no decision to make.
  if (pool.length <= 1) return null;

  const enabledCount = pool.length - excludedCallerIds.filter((n) => pool.includes(n)).length;

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[11px] text-muted-foreground">Dial from</span>
      {pool.map((num) => {
        const on = !excludedCallerIds.includes(num);
        const isLastOn = on && enabledCount <= 1;
        return (
          <button
            key={num}
            type="button"
            disabled={disabled || isLastOn}
            aria-pressed={on}
            onClick={() => onToggle(num)}
            title={
              isLastOn
                ? "At least one number must stay enabled"
                : on
                  ? `Using ${formatPhone(num)} — click to exclude it`
                  : `Excluded — click to re-include ${formatPhone(num)}`
            }
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
              on
                ? "border-primary/40 bg-primary-soft text-primary"
                : "border-border/60 bg-muted/30 text-ink-3 line-through",
              disabled || isLastOn
                ? "cursor-not-allowed opacity-70"
                : "hover:bg-muted/70",
            )}
          >
            <Phone className="h-3 w-3" />
            {formatPhone(num)}
            {active?.callerId === num && (
              <span
                className="inline-flex items-center gap-0.5"
                title={
                  active.localPresence
                    ? "Last call used this number — chosen to match their area code"
                    : "Last call used this number"
                }
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                <span className="sr-only">Used by the last call</span>
                <span aria-hidden>last</span>
              </span>
            )}
          </button>
        );
      })}
      {enabledCount > 1 && (
        <span className="text-[11px] text-ink-3">
          · every {rotateEvery} call{rotateEvery === 1 ? "" : "s"}
        </span>
      )}
    </div>
  );
}
