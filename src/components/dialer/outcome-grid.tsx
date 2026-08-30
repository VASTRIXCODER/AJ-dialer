"use client";

import { motion } from "framer-motion";
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
          <motion.button
            key={opt.key}
            type="button"
            onClick={() => onSelect(opt.value, opt.key)}
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.04, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.95 }}
            className={cn(
              "group flex items-start gap-3 rounded-xl border border-border bg-surface p-3 text-left transition-colors duration-200",
              toneRing[opt.tone],
            )}
          >
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted transition-all duration-200 group-hover:scale-110 group-hover:bg-surface">
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">
                {opt.label}
              </span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {opt.description}
              </span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
