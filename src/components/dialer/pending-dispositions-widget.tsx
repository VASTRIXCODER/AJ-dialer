"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  CalendarCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Loader2,
  PhoneMissed,
  PhoneOff,
  RotateCcw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Voicemail,
  X,
  XCircle,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  needsTime,
  unreviewed,
  type PendingDisposition,
} from "@/lib/dialer/pending-dispositions";
import { resolveOutcomeConfig } from "@/lib/status";
import type { CallOutcome } from "@/lib/types";
import { cn, formatPhone } from "@/lib/utils";

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

const toneText: Record<string, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  accent: "text-accent",
  primary: "text-primary",
  neutral: "text-muted-foreground",
};

/** A small on/off pill toggle — matches the dialer's other inline switches. */
function Toggle({
  on,
  onClick,
  label,
  title,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={title}
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
        on
          ? "border-primary/50 bg-primary-soft text-primary"
          : "border-border bg-background/60 text-muted-foreground hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "flex h-3.5 w-6 items-center rounded-full px-0.5 transition-colors",
          on ? "justify-end bg-primary" : "justify-start bg-muted-foreground/30",
        )}
      >
        <span className="h-2.5 w-2.5 rounded-full bg-white shadow-sm" />
      </span>
      {label}
    </button>
  );
}

/**
 * The power-mode review stack. Every finished call the AI is dispositioning
 * lands here — classifying, then either auto-filed (auto-confirm on) or waiting
 * for a tap. The dialer keeps dialing the whole time; this floats out of its way
 * in the corner and can be collapsed to a pill.
 */
export function PendingDispositionsWidget({
  pending,
  available,
  powerMode,
  autoConfirm,
  onTogglePowerMode,
  onToggleAutoConfirm,
  onConfirm,
  onDismiss,
  onRetry,
  onClearApplied,
}: {
  pending: PendingDisposition[];
  /** Whether this workspace can power-dial at all (manual dialing enabled). When
   *  false the widget never appears; when true it's always present so the rep
   *  can arm power mode even with an empty stack. */
  available: boolean;
  powerMode: boolean;
  autoConfirm: boolean;
  onTogglePowerMode: (next: boolean) => void;
  onToggleAutoConfirm: (next: boolean) => void;
  /** Confirm the suggested outcome, or override it. Caller persists + (for
   *  appointment/callback) opens the time dialog. */
  onConfirm: (row: PendingDisposition, outcome: CallOutcome) => void;
  onDismiss: (id: string) => void;
  onRetry: (id: string) => void;
  onClearApplied: () => void;
}) {
  const vocab = useVocabulary();
  const outcomeCfg = resolveOutcomeConfig(vocab);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Only orgs that manually dial can power-dial. Otherwise the widget is absent.
  if (!available) return null;

  const waiting = unreviewed(pending).length;
  const applied = pending.filter((p) => p.state === "applied").length;
  // The stack only shows once there's something to review or the mode is armed —
  // off and empty, the card is just its header + toggles so the rep can turn it
  // on. (The toggle has to live somewhere reachable, and this is it.)
  const showStack = powerMode || pending.length > 0;
  // Newest first — the rep reviews the call that just happened at the top.
  const rows = [...pending].sort((a, b) => b.createdAt - a.createdAt);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end px-3 pb-3 sm:px-5 sm:pb-5">
      <motion.div
        layout
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-auto flex w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-border bg-card/95 shadow-lift backdrop-blur"
      >
        {/* Header — always visible: the toggles + the stack count */}
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <Zap className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight">
              Auto-dispositions
              {waiting > 0 && (
                <Badge tone="primary" className="tabular">
                  {waiting}
                </Badge>
              )}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {waiting > 0
                ? `${waiting} waiting to review`
                : powerMode
                  ? "Dialing — finished calls land here"
                  : "Power mode is off"}
            </p>
          </div>
          {showStack && (
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              aria-label={collapsed ? "Expand" : "Collapse"}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted"
            >
              <ChevronDown
                className={cn("h-4 w-4 transition-transform", collapsed && "rotate-180")}
              />
            </button>
          )}
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-surface-muted/40 px-4 py-2">
          <Toggle
            on={powerMode}
            onClick={() => onTogglePowerMode(!powerMode)}
            label="Power mode"
            title="Don't stop to disposition — the AI reads each finished call while the dialer keeps going."
          />
          <Toggle
            on={autoConfirm}
            onClick={() => onToggleAutoConfirm(!autoConfirm)}
            label="Auto-confirm"
            title="Apply the AI's disposition automatically. Appointments and callbacks always wait for you to set a time."
          />
        </div>

        {showStack && !collapsed && (
          <div className="max-h-[46vh] overflow-y-auto">
            {rows.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                Finished calls will stack up here while you keep dialing.
              </p>
            ) : (
              <ul className="divide-y divide-border/60">
                <AnimatePresence initial={false}>
                  {rows.map((row) => {
                    const suggested = row.suggestedOutcome;
                    const cfg = suggested ? outcomeCfg[suggested] : null;
                    const SuggIcon = suggested ? icons[suggested] : Sparkles;
                    const isApplied = row.state === "applied";
                    const appliedCfg = row.appliedOutcome
                      ? outcomeCfg[row.appliedOutcome]
                      : null;
                    const AppliedIcon = row.appliedOutcome
                      ? icons[row.appliedOutcome]
                      : Check;
                    const open = expandedId === row.id;
                    return (
                      <motion.li
                        layout
                        key={row.id}
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className={cn("px-4 py-3", isApplied && "opacity-70")}
                      >
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold leading-tight">
                              {row.leadName || formatPhone(row.phone)}
                            </p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {formatPhone(row.phone)}
                              {row.durationSec > 0
                                ? ` · ${Math.round(row.durationSec)}s`
                                : " · no answer"}
                            </p>
                          </div>
                          {!isApplied && (
                            <button
                              type="button"
                              onClick={() => onDismiss(row.id)}
                              aria-label="Dismiss without filing"
                              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-danger"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        {/* ── Classifying ── */}
                        {row.state === "classifying" && (
                          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Reading the call…
                          </p>
                        )}

                        {/* ── Error ── */}
                        {row.state === "error" && (
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <p className="text-xs text-danger">
                              Couldn’t read this call.
                            </p>
                            <button
                              type="button"
                              onClick={() => onRetry(row.id)}
                              className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Retry
                            </button>
                          </div>
                        )}

                        {/* ── Applied ── */}
                        {isApplied && (
                          <p className="mt-2 flex items-center gap-1.5 text-xs">
                            <AppliedIcon
                              className={cn(
                                "h-3.5 w-3.5",
                                toneText[appliedCfg?.tone ?? "neutral"],
                              )}
                            />
                            <span className="font-medium">
                              Filed as {appliedCfg?.label ?? row.appliedOutcome}
                            </span>
                            <span className="text-muted-foreground">
                              {row.autoApplied ? "· auto" : "· by you"}
                            </span>
                          </p>
                        )}

                        {/* ── Suggested — awaiting the rep ── */}
                        {row.state === "suggested" && suggested && (
                          <div className="mt-2 space-y-2">
                            {row.summary && (
                              <p className="line-clamp-2 text-xs text-muted-foreground">
                                {row.summary}
                              </p>
                            )}
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                className="h-8 flex-1 gap-1.5"
                                onClick={() => onConfirm(row, suggested)}
                              >
                                <SuggIcon className="h-3.5 w-3.5" />
                                <span className="truncate">
                                  {needsTime(suggested) ? "Set time · " : ""}
                                  {cfg?.label ?? suggested}
                                </span>
                                {row.confidence != null && (
                                  <span className="opacity-80">{row.confidence}%</span>
                                )}
                              </Button>
                              <button
                                type="button"
                                onClick={() => setExpandedId(open ? null : row.id)}
                                className="flex h-8 items-center gap-1 rounded-lg border border-border px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                              >
                                Change
                                <ChevronDown
                                  className={cn(
                                    "h-3 w-3 transition-transform",
                                    open && "rotate-180",
                                  )}
                                />
                              </button>
                            </div>
                            {open && (
                              <div className="grid grid-cols-2 gap-1.5 pt-1">
                                {(Object.keys(outcomeCfg) as CallOutcome[]).map((o) => {
                                  const OIcon = icons[o];
                                  return (
                                    <button
                                      key={o}
                                      type="button"
                                      onClick={() => {
                                        setExpandedId(null);
                                        onConfirm(row, o);
                                      }}
                                      className={cn(
                                        "flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 text-left text-xs font-medium transition-colors hover:bg-muted",
                                        o === suggested && "border-primary/50 bg-primary-soft",
                                      )}
                                    >
                                      <OIcon
                                        className={cn(
                                          "h-3.5 w-3.5 shrink-0",
                                          toneText[outcomeCfg[o].tone],
                                        )}
                                      />
                                      <span className="truncate">{outcomeCfg[o].label}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </div>
        )}

        {showStack && applied > 0 && !collapsed && (
          <button
            type="button"
            onClick={onClearApplied}
            className="border-t border-border px-4 py-2 text-center text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted"
          >
            Clear {applied} filed
          </button>
        )}
      </motion.div>
    </div>
  );
}
