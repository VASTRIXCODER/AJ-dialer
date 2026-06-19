"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Grid3x3,
  Hash,
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
import { Waveform } from "./waveform";

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
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1.5">
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full border transition-all duration-150 active:scale-90",
          active
            ? danger
              ? "border-danger bg-danger text-danger-foreground shadow-[0_0_20px_-4px_hsl(var(--danger)/0.6)]"
              : "border-primary/60 bg-primary-soft text-primary shadow-[0_0_20px_-4px_hsl(var(--glow)/0.6)]"
            : "border-border/70 bg-surface/60 text-foreground backdrop-blur hover:bg-muted",
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
  hasQueue,
  onStart,
  onManualDial,
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
  hasQueue: boolean;
  onStart: () => void;
  onManualDial: (number: string) => void;
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
  const [manualOpen, setManualOpen] = useState(!hasQueue);
  const canCall = state.mode === "live";
  const name = focusLead ? `${focusLead.firstName} ${focusLead.lastName}` : "No lead";

  const modeBadge =
    state.mode === "live"
      ? { label: "Twilio Live", cls: "bg-success/10 text-success" }
      : state.mode === "offline"
        ? { label: "Twilio offline", cls: "bg-danger/10 text-danger" }
        : { label: "Connecting…", cls: "bg-muted text-muted-foreground" };

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
            modeBadge.cls,
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {modeBadge.label}
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
                <div className="mx-auto mb-4 flex h-20 w-20 animate-float items-center justify-center rounded-3xl bg-solar shadow-glow">
                  <Sparkles className="h-9 w-9 text-white" />
                </div>
                <h2 className="text-xl font-bold">
                  {hasQueue ? "Ready to dial" : "Your queue is empty"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {!hasQueue
                    ? "Connect your lead source to power-dial, or place a manual call below."
                    : state.parallelCount > 1
                      ? `${state.parallelCount} lines will ring at once. First answer connects instantly.`
                      : "Single-line power dialing through your queue."}
                </p>
              </div>

              {hasQueue && (
                <>
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
                              ? "border-primary/60 bg-primary-soft text-primary shadow-[0_0_20px_-6px_hsl(var(--glow)/0.7)]"
                              : "border-border/70 bg-surface/50 text-muted-foreground backdrop-blur hover:bg-muted",
                          )}
                        >
                          {n}X
                        </button>
                      ))}
                    </div>
                  </div>

                  <label className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-border/70 bg-surface/50 px-4 py-3 backdrop-blur">
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
                    disabled={!canCall || !focusLead}
                  >
                    <Radio className="h-5 w-5" />
                    Start {state.parallelCount > 1 ? `${state.parallelCount}X ` : ""}session
                  </Button>
                </>
              )}

              {/* Manual dial */}
              <div className="w-full">
                {hasQueue && (
                  <button
                    type="button"
                    onClick={() => setManualOpen((v) => !v)}
                    className="mx-auto mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    <Hash className="h-4 w-4" />
                    {manualOpen ? "Hide manual dial" : "Dial a number manually"}
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {manualOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <DialPad onCall={onManualDial} callDisabled={!canCall} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {state.error && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {state.error}
                </p>
              )}
              {!state.error && state.lastOutcome && (
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
              initial={{ opacity: 0, scale: 0.94, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: -8 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="flex w-full max-w-sm flex-col items-center gap-5"
            >
              <span className="relative">
                <span
                  className="glow-orb absolute -inset-5 animate-glow-pulse"
                  style={{
                    background:
                      "radial-gradient(circle at center, hsl(var(--success)/0.6), transparent 70%)",
                  }}
                />
                <span className="absolute inset-0 animate-pulse-ring rounded-full" />
                <Avatar
                  initials={initials(name)}
                  color="#10B981"
                  size="lg"
                  className="relative h-24 w-24 text-3xl ring-4 ring-success/30"
                />
              </span>
              <div className="text-center">
                <h2 className="text-2xl font-bold">{name}</h2>
                <p className="text-sm text-muted-foreground">
                  {focusLead.city ? `${focusLead.city}, ${focusLead.state}` : "Manual call"}
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

              {/* Live audio waveform — reacts to the call, flattens on hold */}
              <Waveform
                active={!state.onHold}
                muted={state.muted}
                className="w-full max-w-[280px]"
              />

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
                <ControlButton label={state.muted ? "Unmute" : "Mute"} icon={Mic} activeIcon={MicOff} active={state.muted} onClick={onToggleMute} />
                <ControlButton label="Keypad" icon={Grid3x3} active={showKeypad} onClick={() => setShowKeypad((v) => !v)} />
                <ControlButton label={state.onHold ? "Resume" : "Hold"} icon={Pause} activeIcon={Play} active={state.onHold} onClick={onToggleHold} />
                <ControlButton label="Record" icon={Radio} active={state.recording} danger onClick={onToggleRecording} />
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
