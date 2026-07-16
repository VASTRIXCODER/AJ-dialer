"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Bot,
  ExternalLink,
  Grid3x3,
  Hash,
  Loader2,
  Lock,
  Mic,
  MicOff,
  Pause,
  Phone,
  PhoneOff,
  Play,
  Radio,
  RotateCcw,
  SkipForward,
  Sparkles,
  StopCircle,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AiLockReason } from "@/lib/org/settings";
import type { CallOutcome, Lead } from "@/lib/types";
import type { AiLaunch, DialerState, KnownInfo } from "@/lib/use-dialer";
import { cn, formatDuration, initials } from "@/lib/utils";
import { AiCallSummary } from "@/components/ai/call-summary";
import { DialPad } from "./dial-pad";
import { KnownInfoDialog } from "./known-info-dialog";
import { OutcomeGrid } from "./outcome-grid";
import { ParallelLines } from "./parallel-lines";
import { Waveform } from "./waveform";

/**
 * Concurrency choices, up to the mode's ceiling. Below 6 we offer every value;
 * above that we step (1,2,3,5,10,…) so a 30-line ceiling doesn't render 30 chips.
 */
function parallelChoices(max: number): number[] {
  const ladder = [1, 2, 3, 5, 10, 15, 20, 25, 30];
  const out =
    max <= 5 ? [1, 2, 3, 4, 5].filter((n) => n <= max) : ladder.filter((n) => n <= max);
  if (!out.includes(max)) out.push(max);
  return out.slice(0, 10);
}

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
  aiConfigured,
  manualEnabled = true,
  aiEnabled = true,
  aiLockReason = null,
  secondAgentConfigured = false,
  agentNames,
  onSetActiveAgent,
  onStart,
  onManualDial,
  onAiDialNumber,
  onEnd,
  onSkip,
  onOutcome,
  onToggleMute,
  onToggleHold,
  onToggleRecording,
  onDigit,
  onSetParallel,
  onSetAutoDial,
  onSetAiMode,
  onLaunchNextAI,
  onStopAICampaign,
  onEndAISession,
  onReconnect,
}: {
  state: DialerState;
  focusLead: Lead | null;
  hasQueue: boolean;
  aiConfigured: boolean;
  manualEnabled?: boolean;
  aiEnabled?: boolean;
  aiLockReason?: AiLockReason;
  /** A distinct second AI agent is configured — shows the agent picker in AI mode. */
  secondAgentConfigured?: boolean;
  /** Display labels for the two AI agents. */
  agentNames?: { primary: string; secondary: string };
  onSetActiveAgent?: (agent: "primary" | "secondary") => void;
  onStart: () => void;
  onManualDial: (number: string, name?: string) => void;
  onAiDialNumber: (phone: string, known: KnownInfo) => void;
  onEnd: () => void;
  onSkip: () => void;
  onOutcome: (o: CallOutcome) => void;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onToggleRecording: () => void;
  onDigit: (d: string) => void;
  onSetParallel: (n: number) => void;
  onSetAutoDial: (b: boolean) => void;
  onSetAiMode: (b: boolean) => void;
  onLaunchNextAI: () => void;
  onStopAICampaign: () => void;
  onEndAISession: () => void;
  onReconnect: () => void;
}) {
  const [showKeypad, setShowKeypad] = useState(false);
  const [manualOpen, setManualOpen] = useState(!hasQueue);
  const [pendingAiNumber, setPendingAiNumber] = useState<string | null>(null);
  // AI is usable only when configured AND permitted for this viewer; when it's
  // locked we still surface the option, just disabled with a reason.
  const aiUsable = aiConfigured && aiEnabled;
  const ai = state.aiMode && aiUsable;
  const canCall = state.mode === "live";
  const canStart = ai ? hasQueue : canCall && Boolean(focusLead);
  const name = focusLead ? `${focusLead.firstName} ${focusLead.lastName}` : "No lead";
  // Show the AI/Manual selector whenever AI is configured, or either mode is
  // locked (so the lock — premium plan or rep role — is visible, not hidden).
  const showModeBar = aiConfigured || !aiEnabled || !manualEnabled;
  const aiLockText =
    aiLockReason === "role"
      ? "The AI dialer is available to admins and managers."
      : "AI dialing is a premium feature on this plan.";

  const modeBadge = ai
    ? { label: "AI agent ready", cls: "bg-accent-soft text-accent" }
    : state.mode === "live"
      ? { label: "Twilio Live", cls: "bg-success/10 text-success" }
      : state.mode === "offline"
        ? { label: "Twilio offline", cls: "bg-danger/10 text-danger" }
        : { label: "Connecting…", cls: "bg-muted text-muted-foreground" };

  return (
    <div className="flex h-full flex-col">
      {/* Session bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-1.5 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-semibold">
            <Radio className="h-4 w-4 text-primary" />
            Session
          </span>
          <span className="text-muted-foreground">
            <b className="font-bold text-foreground tabular">{state.callsThisSession}</b> dials
          </span>
          {/* "Connects" is a human-dial fact (the rep's line went live). AI connect
              state lives on the server / Live Monitor, not here, so showing a
              client-side counter in AI mode only ever read a permanent "0 connects".
              Hide it in AI mode rather than display a number we can't truthfully know. */}
          {!ai && (
            <span className="text-muted-foreground">
              <b className="font-bold text-foreground tabular">{state.connectsThisSession}</b> connects
            </span>
          )}
          <span className="text-[11px] text-muted-foreground/70">this session</span>
          {/* All-day dial counter (persisted across sessions/reloads), distinct
              from the per-session count above. Was computed but never shown. */}
          {state.dialsToday > 0 && (
            <span className="text-muted-foreground">
              <b className="font-bold text-foreground tabular">{state.dialsToday}</b> today
            </span>
          )}
          {/* Caller-ID rotation indicator */}
          {state.callerIdInfo && state.callerIdInfo.pool.length > 0 && (
            <span
              title={`Pool: ${state.callerIdInfo.pool.join(", ")} · rotates every ${state.callerIdInfo.rotateEvery} call${state.callerIdInfo.rotateEvery === 1 ? "" : "s"}`}
              className="flex items-center gap-1 rounded-md border border-border/60 bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
            >
              <Phone className="h-3 w-3 text-primary" />
              {state.callerIdInfo.callerId.replace(/^\+1/, "")}
              {state.callerIdInfo.pool.length > 1 && (
                <>
                  <span className="text-muted-foreground/60">·</span>
                  <RotateCcw className="h-3 w-3" />
                  <span>
                    {state.callerIdInfo.poolIndex + 1}/{state.callerIdInfo.pool.length}
                  </span>
                </>
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* When the device drops (token lapse, network blip, Safari quirk) the
              rep gets a one-tap recovery instead of having to reload — reloading
              didn't reliably fix it. */}
          {state.mode === "offline" && (
            <button
              type="button"
              onClick={onReconnect}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted active:scale-95"
            >
              <RotateCcw className="h-3 w-3" />
              Reconnect
            </button>
          )}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              modeBadge.cls,
            )}
          >
            {state.mode === "connecting" ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
            )}
            {modeBadge.label}
          </span>
        </div>
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
              {/* AI / Manual toggle. A mode that's locked — AI for reps or on a
                  manual-only plan, Manual on an AI-only plan — still shows, but
                  disabled with a lock, so it reads as gated rather than missing. */}
              {showModeBar && (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="inline-flex rounded-xl border border-border bg-card p-1">
                    {aiEnabled ? (
                      <button
                        type="button"
                        onClick={() => onSetAiMode(true)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
                          ai ? "bg-solar text-white shadow-soft" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Bot className="h-4 w-4" />
                        AI calling
                      </button>
                    ) : (
                      <span
                        title={aiLockText}
                        className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-muted-foreground/60"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        AI calling
                      </span>
                    )}
                    {manualEnabled ? (
                      <button
                        type="button"
                        onClick={() => onSetAiMode(false)}
                        className={cn(
                          "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
                          !ai ? "bg-foreground text-background shadow-soft" : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Hash className="h-4 w-4" />
                        Manual
                      </button>
                    ) : (
                      <span
                        title="Manual dialing is a premium feature — locked on this plan."
                        className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold text-muted-foreground/60"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Manual
                      </span>
                    )}
                  </div>
                  {!aiEnabled && (
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      {aiLockText}
                    </p>
                  )}
                  {!manualEnabled && (
                    <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Lock className="h-3 w-3" />
                      Manual dialing is a premium feature on this plan.
                    </p>
                  )}
                </div>
              )}

              {/* Agent picker — which AI persona to dial as. Only meaningful in AI
                  mode and only when a second agent is actually configured. */}
              {ai && secondAgentConfigured && onSetActiveAgent && (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="inline-flex rounded-xl border border-border bg-card p-1">
                    {(["primary", "secondary"] as const).map((key) => {
                      const active = state.activeAgent === key;
                      const label =
                        key === "primary"
                          ? agentNames?.primary || "Emily"
                          : agentNames?.secondary || "Emily (Sunrun)";
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => onSetActiveAgent(key)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
                            active
                              ? "bg-solar text-white shadow-soft"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <Bot className="h-4 w-4" />
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-muted-foreground">Which AI agent places the call</p>
                </div>
              )}

              <div className="text-center">
                <div
                  className={cn(
                    "mx-auto mb-4 flex h-20 w-20 animate-float items-center justify-center rounded-3xl shadow-glow",
                    ai ? "bg-solar" : "bg-solar",
                  )}
                >
                  {ai ? (
                    <Bot className="h-9 w-9 text-white" />
                  ) : (
                    <Sparkles className="h-9 w-9 text-white" />
                  )}
                </div>
                <h2 className="text-xl font-bold">
                  {hasQueue
                    ? ai
                      ? "Ready — AI will dial"
                      : "Ready to dial"
                    : "Your queue is empty"}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {!hasQueue
                    ? ai
                      ? "Import leads to let the AI agent start calling your list."
                      : "Connect your lead source to power-dial, or place a manual call below."
                    : ai
                      ? state.parallelCount > 1
                        ? `The AI agent will call ${state.parallelCount} homeowners at once. Oversee them in the Live Monitor.`
                        : "The AI agent dials, qualifies & books — you oversee from the Live Monitor."
                      : state.parallelCount > 1
                        ? `${state.parallelCount} lines will ring at once. First answer connects instantly.`
                        : "Single-line power dialing through your queue."}
                </p>
              </div>

              {hasQueue && (
                <>
                  <div className="w-full">
                    <p className="mb-2 text-center text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {ai ? "Calls at once" : "Parallel lines"}
                      <span className="ml-1.5 font-medium normal-case tracking-normal opacity-60">
                        max {state.maxParallel}
                      </span>
                    </p>
                    <div className="grid grid-cols-5 gap-2">
                      {parallelChoices(state.maxParallel).map((n) => (
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
                      {ai ? "Auto-dial the whole list" : "Auto-dial next"}
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
                  {state.autoDial && (
                    <p className="-mt-2 text-center text-[11px] text-muted-foreground">
                      Keeps dialing through your whole list on repeat — refreshing it after
                      each pass so anyone just dispositioned isn&apos;t called again.
                      {ai && " Keep this tab open; for calling with the tab closed, use Admin → Automated calling."}
                    </p>
                  )}

                  <Button
                    size="lg"
                    className="w-full gap-2"
                    onClick={onStart}
                    disabled={!canStart}
                  >
                    {ai ? <Bot className="h-5 w-5" /> : <Radio className="h-5 w-5" />}
                    {ai
                      ? `Start AI ${state.parallelCount > 1 ? `${state.parallelCount}X ` : ""}session`
                      : `Start ${state.parallelCount > 1 ? `${state.parallelCount}X ` : ""}session`}
                  </Button>
                  {ai && !canCall && (
                    <p className="-mt-2 text-center text-[11px] text-muted-foreground">
                      No Twilio needed — the AI agent places the calls.
                    </p>
                  )}
                </>
              )}

              {/* Dial a specific number — with AI or manually */}
              <div className="w-full">
                {hasQueue && (
                  <button
                    type="button"
                    onClick={() => setManualOpen((v) => !v)}
                    className="mx-auto mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    <Hash className="h-4 w-4" />
                    {manualOpen ? "Hide number pad" : "Dial a specific number"}
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
                      <DialPad
                        onAiCall={aiUsable ? (num) => setPendingAiNumber(num) : undefined}
                        onCall={onManualDial}
                        callDisabled={!canCall || !manualEnabled}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {!hasQueue && ai && (
                <Link
                  href="/leads"
                  className={buttonVariants({ variant: "outline", className: "gap-2" })}
                >
                  <Sparkles className="h-4 w-4" />
                  Import leads
                </Link>
              )}

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

          {/* ── AI SESSION ───────────────────────────────────────── */}
          {state.status === "ai" && (
            <AiSession
              calls={state.aiCalls}
              campaign={state.aiCampaign}
              parallelCount={state.parallelCount}
              hasMore={hasQueue}
              onLaunchNext={onLaunchNextAI}
              onStop={onStopAICampaign}
              onEnd={onEndAISession}
            />
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
              <AiCallSummary leadId={focusLead?.id ?? null} />
              <OutcomeGrid onSelect={onOutcome} />
              <Button variant="ghost" className="gap-2 text-muted-foreground" onClick={onSkip}>
                <SkipForward className="h-4 w-4" />
                Skip without disposition
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {pendingAiNumber && (
        <KnownInfoDialog
          phone={pendingAiNumber}
          onClose={() => setPendingAiNumber(null)}
          onSubmit={(known) => {
            onAiDialNumber(pendingAiNumber, known);
            setPendingAiNumber(null);
          }}
        />
      )}
    </div>
  );
}

// ── AI session panel ──────────────────────────────────────────────────────────
function AiSession({
  calls,
  campaign,
  parallelCount,
  hasMore,
  onLaunchNext,
  onStop,
  onEnd,
}: {
  calls: AiLaunch[];
  campaign: "idle" | "running" | "done";
  parallelCount: number;
  hasMore: boolean;
  onLaunchNext: () => void;
  onStop: () => void;
  onEnd: () => void;
}) {
  const active = calls.filter((c) => c.conversationId && !c.error).length;
  const firstConv = calls.find((c) => c.conversationId)?.conversationId ?? null;

  return (
    <motion.div
      key="ai"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex w-full max-w-sm flex-col gap-4"
    >
      <div className="text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-solar shadow-glow">
          <Bot className="h-8 w-8 text-white" />
        </div>
        <h2 className="text-lg font-bold">
          {campaign === "done" ? "Campaign complete" : "AI agent is calling"}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {campaign === "running"
            ? "Auto-dialing your list. Oversee, listen & take over in the Live Monitor."
            : `${active} live · oversee & take over in the Live Monitor.`}
        </p>
      </div>

      <div className="max-h-52 space-y-2 overflow-y-auto">
        {calls.slice(0, 12).map((c, i) => (
          <div
            key={`${c.leadId}-${i}`}
            className="flex items-center gap-3 rounded-xl border border-border/60 bg-surface/50 px-3 py-2"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-solar/90 text-white">
              <Bot className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.leadName}</span>
            {c.error ? (
              <Badge tone="danger" className="shrink-0">Failed</Badge>
            ) : c.conversationId ? (
              <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-success">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                Calling
              </span>
            ) : (
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Placing
              </span>
            )}
          </div>
        ))}
      </div>

      <Link
        href={firstConv ? `/monitor?call=${encodeURIComponent(firstConv)}` : "/monitor"}
        className={buttonVariants({ size: "lg", className: "w-full gap-2" })}
      >
        <ExternalLink className="h-5 w-5" />
        Open Live Monitor
      </Link>

      <div className="flex gap-2">
        {campaign === "running" ? (
          <Button variant="outline" className="flex-1 gap-2" onClick={onStop}>
            <StopCircle className="h-4 w-4" />
            Stop auto-dial
          </Button>
        ) : (
          campaign !== "done" &&
          hasMore && (
            <Button variant="outline" className="flex-1 gap-2" onClick={onLaunchNext}>
              <Bot className="h-4 w-4" />
              Call next {parallelCount > 1 ? parallelCount : ""}
            </Button>
          )
        )}
        <Button variant="ghost" className="flex-1 gap-2 text-muted-foreground" onClick={onEnd}>
          <PhoneOff className="h-4 w-4" />
          End session
        </Button>
      </div>
    </motion.div>
  );
}
