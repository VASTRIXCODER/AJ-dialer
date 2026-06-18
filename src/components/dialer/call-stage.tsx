"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  Grid3x3,
  Mic,
  MicOff,
  Pause,
  PhoneOff,
  Play,
  Radio,
  SkipForward,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import type { CallOutcome, Lead } from "@/lib/types";
import type { DialerState } from "@/lib/use-dialer";
import { cn, formatDuration, initials } from "@/lib/utils";
import { DialPad } from "./dial-pad";
import { OutcomeGrid } from "./outcome-grid";
import { ParallelLines } from "./parallel-lines";

function ControlButton({
  active,
  onClick,
  icon: Icon,
  activeIcon: ActiveIcon,
  label,
  danger,
}: {
  active?: boolean;
  onClick: () => void;
  icon: typeof Mic;
  activeIcon?: typeof Mic;
  label: string;
  danger?: boolean;
}) {
  const Display = active && ActiveIcon ? ActiveIcon : Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-1.5"
    >
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full border transition-all duration-150 active:scale-90",
          active
            ? danger
              ? "border-danger bg-danger text-danger-foreground"
              : "border-primary bg-primary-soft text-primary"
            : "border-border bg-surface text-foreground hover:bg-muted",
        )}
      >
        <Display className="h-5 w-5" />
      </span>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </button>
  );
}

export function CallStage({
  state,
  focusLead,
  onStart,
  onEnd,
  onSkip,
  onOutcome,
  onToggleMute,
  onToggleHold,
  onToggleRecording,
  onDigit,
  onSetParallel,
  onSetAutoDial,
}: {
  state: DialerState;
  focusLead: Lead | null;
  onStart: () => void;
  onEnd: () => void;
  onSkip: () => void;
  onOutcome: (o: CallOutcome) => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onToggleRecording: () => void;
  onDigit: (d: string) => void;
  onSetParallel: (n: number) => void;
  onSetAutoDial: (b: boolean) => void;
}) {
  const [showKeypad, setShowKeypad] = useState(false);
  const name = focusLead
    ? `${focusLead.firstName} ${focusLead.lastName}`
    : "No lead";

  return (
    <div className="flex h-full flex-col">
      {/* Session bar */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5 font-semibold">
            <Radio className="h-4 w-4 text-primary" />
            Session
          </span>
          <span className="text-muted-foreground">
            <b className="font-bold text-foreground tabular">{state.callsThisSession}</b> dials
          </span>
          <span className="text-muted-foreground">
            <b className="font-bold text-foreground tabular">{state.connectsThisSession}</b> connects
          </span>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
            state.mode === "live"
              ? "bg-success/10 text-success"
              : state.mode === "demo"
                ? "bg-warning/10 text-warning"
                : "bg-muted text-muted-foreground",
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {state.mode === "live"
            ? "Twilio Live"
            : state.mode === "demo"
              ? "Simulation"
              : "Connecting…"}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center p-6">
        <AnimatePresence mode="wait">
          {/* ── IDLE ─────────────────────────────────────────────── */}
          {state.status === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex w-full max-w-sm flex-col items-center gap-6"
            >
              <div className="text-center">
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-solar shadow-glow">
                  <Sparkles className="h-9 w-9 text-white" />
                </div>
                <h2 className="text-xl font-bold">Ready to dial</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {state.parallelCount > 1
                    ? `${state.parallelCount} lines will ring simultaneously. First answer connects instantly.`
                    : "Single-line power dialing through your queue."}
                </p>
              </div>

              {/* Parallel selector */}
              <div className="w-full">
                <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Parallel lines
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[1, 2, 3].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => onSetParallel(n)}
                      className={cn(
                        "rounded-xl border py-2.5 text-sm font-bold transition-all active:scale-95",
                        state.parallelCount === n
                          ? "border-primary bg-primary-soft text-primary"
                          : "border-border bg-surface text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {n}X
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  <SkipForward className="h-4 w-4 text-muted-foreground" />
                  Auto-dial next
                </span>
                <input
                  type="checkbox"
                  checked={state.autoDial}
                  onChange={(e) => onSetAutoDial(e.target.checked)}
                  className="peer sr-only"
                />
                <span className="relative h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary">
                  <span
                    className={cn(
                      "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                      state.autoDial && "translate-x-5",
                    )}
                  />
                </span>
              </label>

              <Button
                size="lg"
                className="w-full gap-2"
                onClick={onStart}
                disabled={!focusLead}
              >
                <Radio className="h-5 w-5" />
                Start {state.parallelCount > 1 ? `${state.parallelCount}X ` : ""}session
              </Button>

              {state.lastOutcome && (
                <p className="text-xs text-muted-foreground">
                  Last outcome saved:{" "}
                  <span className="font-semibold capitalize text-foreground">
                    {state.lastOutcome.replace(/_/g, " ")}
                  </span>
                </p>
              )}
            </motion.div>
          )}

          {/* ── DIALING ──────────────────────────────────────────── */}
          {state.status === "dialing" && (
            <motion.div
              key="dialing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex w-full max-w-sm flex-col gap-5"
            >
              <div className="text-center">
                <p className="text-sm font-semibold text-warning">
                  Dialing {state.lines.length} line{state.lines.length > 1 ? "s" : ""}…
                </p>
                <p className="text-xs text-muted-foreground">
                  Connecting you to the first homeowner who answers
                </p>
              </div>
              <ParallelLines lines={state.lines} />
              <Button variant="outline" className="w-full gap-2" onClick={onSkip}>
                <PhoneOff className="h-4 w-4" />
                Cancel
              </Button>
            </motion.div>
          )}

          {/* ── LIVE ─────────────────────────────────────────────── */}
          {state.status === "live" && focusLead && (
            <motion.div
              key="live"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="flex w-full max-w-sm flex-col items-center gap-5"
            >
              <span className="relative">
                <span className="absolute inset-0 animate-pulse-ring rounded-full" />
                <Avatar initials={initials(name)} color="#16a34a" size="lg" className="h-24 w-24 text-3xl" />
              </span>
              <div className="text-center">
                <h2 className="text-2xl font-bold">{name}</h2>
                <p className="text-sm text-muted-foreground">
                  {focusLead.city}, {focusLead.state}
                </p>
                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-sm font-bold text-success tabular">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  {formatDuration(state.durationSec)}
                  {state.onHold && <span className="text-warning">· On hold</span>}
                  {state.recording && (
                    <span className="flex items-center gap-1 text-danger">
                      · <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-danger" /> REC
                    </span>
                  )}
                </div>
              </div>

              <AnimatePresence>
                {showKeypad && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="w-full overflow-hidden"
                  >
                    <DialPad compact onDigit={onDigit} />
                  </motion.div>
                )}
              </AnimatePresence>

              <div className="flex items-center justify-center gap-5">
                <ControlButton
                  label={state.muted ? "Unmute" : "Mute"}
                  icon={Mic}
                  activeIcon={MicOff}
                  active={state.muted}
                  onClick={onToggleMute}
                />
                <ControlButton
                  label="Keypad"
                  icon={Grid3x3}
                  active={showKeypad}
                  onClick={() => setShowKeypad((v) => !v)}
                />
                <ControlButton
                  label={state.onHold ? "Resume" : "Hold"}
                  icon={Pause}
                  activeIcon={Play}
                  active={state.onHold}
                  onClick={onToggleHold}
                />
                <ControlButton
                  label="Record"
                  icon={Radio}
                  active={state.recording}
                  danger
                  onClick={onToggleRecording}
                />
              </div>

              <Button variant="danger" size="lg" className="w-full gap-2" onClick={onEnd}>
                <PhoneOff className="h-5 w-5" />
                End call
              </Button>
            </motion.div>
          )}

          {/* ── WRAP-UP ──────────────────────────────────────────── */}
          {state.status === "wrapup" && (
            <motion.div
              key="wrapup"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="flex w-full max-w-md flex-col gap-4"
            >
              <div className="text-center">
                <h2 className="text-lg font-bold">Disposition this call</h2>
                <p className="text-sm text-muted-foreground">
                  {name} · {formatDuration(state.durationSec)} talk time
                </p>
              </div>
              <OutcomeGrid onSelect={onOutcome} />
              <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={onSkip}>
                <SkipForward className="h-4 w-4" />
                Skip without disposition
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
