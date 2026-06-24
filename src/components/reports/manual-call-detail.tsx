"use client";

import { motion } from "framer-motion";
import {
  CalendarCheck,
  ClipboardList,
  Phone,
  Play,
  User,
  X,
} from "lucide-react";
import { useEffect } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Portal } from "@/components/ui/portal";
import type { RecentCall } from "@/lib/db/metrics";
import { outcomeConfig } from "@/lib/status";
import { formatClock, formatDay, formatDuration, formatPhone, initials } from "@/lib/utils";

/**
 * Full per-call breakdown for a MANUAL (human) call — the human-channel
 * counterpart to the AI CallDashboard. Shows the rep, disposition, an executive
 * summary, and the call recording so Reports gives the same depth for manual
 * calls as it does for AI calls.
 */
export function ManualCallDetail({
  call,
  onClose,
}: {
  call: RecentCall;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const cfg = call.outcome ? outcomeConfig[call.outcome] : null;
  const name = call.leadName || "Homeowner";

  return (
    <Portal>
      <motion.div
        className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="absolute inset-0 bg-background/70 backdrop-blur-xl"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        />

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="glass relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border/60 shadow-lift sm:max-h-[88vh] sm:rounded-2xl"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <User className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold leading-tight">{name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[call.phone ? formatPhone(call.phone) : null, "Manual call"]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="neutral" className="gap-1">
                <Phone className="h-3 w-3" />
                Manual
              </Badge>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Status strip */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border/60 bg-muted/40 px-5 py-2.5 text-xs text-muted-foreground">
            {call.repName && (
              <span className="flex items-center gap-1.5">
                <Avatar initials={initials(call.repName)} color="#0EA5E9" size="xs" />
                <span className="font-medium text-foreground">{call.repName}</span>
              </span>
            )}
            <span className="tabular">
              {formatDay(call.startedAt)} · {formatClock(call.startedAt)}
            </span>
            {cfg && <Badge tone={cfg.tone}>{cfg.label}</Badge>}
            <span className="ml-auto font-mono text-sm font-bold tabular text-foreground">
              {call.durationSec ? formatDuration(call.durationSec) : "—"}
            </span>
          </div>

          {/* Body */}
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {call.summary ? (
              <div className="rounded-xl border border-border/60 bg-surface/60 p-4">
                <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <ClipboardList className="h-3.5 w-3.5" />
                  Call summary
                </p>
                <p className="text-sm leading-relaxed">{call.summary}</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
                A summary is generated shortly after the call is dispositioned.
              </div>
            )}

            {call.outcome === "appointment_booked" && (
              <div className="flex items-center gap-2 rounded-xl border border-success/30 bg-success/5 p-4 text-sm font-semibold text-success">
                <CalendarCheck className="h-4 w-4" />
                Appointment booked — see the Appointments tab for details.
              </div>
            )}

            {call.hasRecording && call.recordingUrl ? (
              <div className="rounded-xl border border-border/60 bg-surface/60 p-4">
                <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  <Play className="h-3.5 w-3.5" />
                  Recording
                </p>
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls preload="none" src={call.recordingUrl} className="w-full" />
              </div>
            ) : (
              <p className="text-center text-xs text-muted-foreground">
                {call.outcome && ["no_answer", "voicemail", "wrong_number"].includes(call.outcome)
                  ? "No recording — the call didn't connect."
                  : "Recording will appear here once Twilio finishes processing it."}
              </p>
            )}
          </div>
        </motion.div>
      </motion.div>
    </Portal>
  );
}
