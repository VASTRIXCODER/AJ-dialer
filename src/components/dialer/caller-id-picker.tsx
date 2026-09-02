"use client";

import { MapPin, Phone, RotateCcw } from "lucide-react";
import { areaCodeOf } from "@/lib/dialer/rotation";
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
  localPresence,
  onSetLocalPresence,
  /** The lead about to be dialed — its area code is what a match aims at. */
  destPhone,
}: {
  /** The org's effective caller-ID pool (resolved server-side). */
  pool: string[];
  /** Calls per number before rotation advances to the next enabled one. */
  rotateEvery: number;
  /** Numbers the rep has toggled off. */
  excludedCallerIds: string[];
  /** What the last placed call actually used — marks the active pill. */
  active: CallerIdInfo | null;
  /** True while a call is in flight — toggling mid-call is a no-op. */
  disabled: boolean;
  onToggle: (callerId: string) => void;
  /** Area-code matching on for this rep (org default, overridden per rep). */
  localPresence?: boolean;
  /** Omit to hide the control entirely (e.g. nothing to match against). */
  onSetLocalPresence?: (value: boolean) => void;
  destPhone?: string | null;
}) {
  // Nothing to choose between — a 0-or-1-number pool has no decision to make,
  // and with one number there is no area code to match either.
  if (pool.length <= 1) return null;

  const enabledCount = pool.length - excludedCallerIds.filter((n) => pool.includes(n)).length;

  // What a match would actually aim at, and whether this rep's ENABLED numbers
  // can hit it. Saying "no local number for 214" up front is far better than
  // silently falling back to rotation and leaving the rep wondering.
  const destAreaCode = areaCodeOf(destPhone ?? null);
  const enabledPool = pool.filter((n) => !excludedCallerIds.includes(n));
  const hasMatch = destAreaCode
    ? enabledPool.some((n) => areaCodeOf(n) === destAreaCode)
    : false;

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
                : "border-border/60 bg-muted/30 text-muted-foreground/50 line-through",
              disabled || isLastOn
                ? "cursor-not-allowed opacity-70"
                : "hover:bg-muted/70",
            )}
          >
            <Phone className="h-3 w-3" />
            {formatPhone(num)}
            {active?.callerId === num && <RotateCcw className="h-3 w-3" />}
          </button>
        );
      })}
      {enabledCount > 1 && !localPresence && (
        <span className="text-[11px] text-muted-foreground/70">
          · every {rotateEvery} call{rotateEvery === 1 ? "" : "s"}
        </span>
      )}

      {/* Local presence: dial from a number in the lead's own area code when
          the pool has one. Sits with the caller-ID pills because it decides
          the same thing they do — which number the homeowner sees. */}
      {onSetLocalPresence && (
        <button
          type="button"
          disabled={disabled}
          aria-pressed={Boolean(localPresence)}
          onClick={() => onSetLocalPresence(!localPresence)}
          title={
            localPresence
              ? destAreaCode
                ? hasMatch
                  ? `Matching the lead's area code (${destAreaCode}) — click to rotate normally instead`
                  : `No enabled number in ${destAreaCode}, so this call rotates normally. Add a ${destAreaCode} number to match it.`
                : "Dialing from a number in the lead's area code when the pool has one — click to rotate normally instead"
              : "Off — numbers rotate regardless of where the lead is. Click to match the lead's area code."
          }
          className={cn(
            "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors",
            localPresence
              ? hasMatch || !destAreaCode
                ? "border-success/40 bg-success/10 text-success"
                : // On, but nothing in the pool can match this lead.
                  "border-warning/40 bg-warning/10 text-warning"
              : "border-border/60 bg-muted/30 text-muted-foreground",
            disabled ? "cursor-not-allowed opacity-70" : "hover:bg-muted/70",
          )}
        >
          <MapPin className="h-3 w-3" />
          {localPresence && destAreaCode
            ? hasMatch
              ? `Matching ${destAreaCode}`
              : `No ${destAreaCode} number`
            : "Match area code"}
        </button>
      )}
    </div>
  );
}
