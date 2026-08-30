"use client";

import {
  Ban,
  CalendarCheck,
  CheckCircle2,
  PhoneMissed,
  PhoneOff,
  ThumbsDown,
  ThumbsUp,
  Voicemail,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { filterOutcomeOptionsByKeys, resolveOutcomeOptions } from "@/lib/status";
import type { CallOutcome } from "@/lib/types";
import { cn } from "@/lib/utils";

// Keyed by canonical outcome, so a custom def borrows the icon of the outcome
// its behavior lands on — a "Left with spouse" callback row gets the callback
// icon, which is what pressing it actually does.
const icons: Record<CallOutcome, LucideIcon> = {
  appointment_booked: CalendarCheck,
  callback_scheduled: PhoneMissed,
  qualified: ThumbsUp,
  not_interested: ThumbsDown,
  bills_fine: CheckCircle2,
  no_answer: PhoneOff,
  voicemail: Voicemail,
  wrong_number: XCircle,
  do_not_call: Ban,
};

const toneRing: Record<string, string> = {
  success: "hover:border-success/50 hover:bg-success/10 [&_svg]:text-success",
  warning: "hover:border-warning/50 hover:bg-warning/10 [&_svg]:text-warning",
  danger: "hover:border-danger/50 hover:bg-danger/10 [&_svg]:text-danger",
  neutral: "hover:border-primary/40 hover:bg-muted [&_svg]:text-muted-foreground",
};

/**
 * The wrap-up buttons. Renders the ORG's resolved disposition taxonomy (labels,
 * tones, order, enabled — all from Admin → Call dispositions) instead of the
 * hardcoded nine-value union it used to draw (audit R2: the editor was a dead
 * control). Selecting submits BOTH facts: the canonical outcome that reports
 * and the pipeline act on, and the def key that was actually pressed.
 */
export function OutcomeGrid({
  onSelect,
  dispositions,
  allowedKeys,
  showKeys = false,
}: {
  /** `outcome` is always canonical; `dispositionKey` is the pressed def's key
   *  (equal to `outcome` for system rows, `x_*` for admin-created rows). */
  onSelect: (outcome: CallOutcome, dispositionKey: string) => void;
  /** The org's stored `settings.dispositions`. Absent ⇒ the canonical nine —
   *  surfaces with no org settings in scope keep today's exact grid. */
  dispositions?: unknown;
  /** Campaign `disposition_keys` subset — when non-empty, only those defs
   *  render (do-not-call always survives; it's legally load-bearing). */
  allowedKeys?: string[];
  /** Draw the 1–9 hotkey on each button. TRUE ONLY where those keys are bound
   *  — the dialer's wrap-up. The other four call sites (the pipeline row menu,
   *  the appointments workspace and dialog, the monitor dashboard) render the
   *  same grid with no digit handler mounted, and a key that does nothing is
   *  worse than no key at all. */
  showKeys?: boolean;
}) {
  const options = filterOutcomeOptionsByKeys(
    resolveOutcomeOptions(useVocabulary(), dispositions),
    allowedKeys,
  );
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {options.map((opt, i) => {
        const Icon = icons[opt.value];
        return (
          <button
            key={opt.key}
            type="button"
            onClick={() => onSelect(opt.value, opt.key)}
            className={cn(
              // Colour on the 90ms state curve, and nothing else. This grid
              // used to cascade in one button at a time over two thirds of a
              // second at the end of every single call, lift 3px under the
              // cursor and shrink on press. A rep files 150 of these a day.
              "group flex items-start gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors duration-[var(--dur-state)]",
              toneRing[opt.tone],
            )}
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted transition-colors duration-[var(--dur-state)] group-hover:bg-surface">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold leading-tight">
                {opt.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {opt.description}
              </span>
            </span>
            {/* The key that presses this button. It was documented only inside
                the [?] sheet, so learning it meant interrupting wrap-up and
                then counting buttons to match labels back to numbers. */}
            {showKeys && i < 9 && (
              <span
                className="mt-0.5 shrink-0 rounded-md border border-border px-1.5 text-[11px] font-bold tabular text-muted-foreground"
                aria-hidden
              >
                {i + 1}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
