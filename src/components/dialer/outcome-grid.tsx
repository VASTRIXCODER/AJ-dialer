"use client";

import { motion } from "framer-motion";
import {
  Ban,
  CalendarCheck,
  PhoneMissed,
  PhoneOff,
  ThumbsDown,
  ThumbsUp,
  Voicemail,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { CallOutcome } from "@/lib/types";
import { outcomeOptions } from "@/lib/data";
import { cn } from "@/lib/utils";

const icons: Record<CallOutcome, LucideIcon> = {
  appointment_booked: CalendarCheck,
  callback_scheduled: PhoneMissed,
  qualified: ThumbsUp,
  not_interested: ThumbsDown,
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

export function OutcomeGrid({
  onSelect,
}: {
  onSelect: (outcome: CallOutcome) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {outcomeOptions.map((opt, i) => {
        const Icon = icons[opt.value];
        return (
          <motion.button
            key={opt.value}
            type="button"
            onClick={() => onSelect(opt.value)}
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
