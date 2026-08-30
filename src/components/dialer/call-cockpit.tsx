"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Bot,
  Grid3x3,
  Hash,
  Loader2,
  Mic,
  MicOff,
  MessageSquareText,
  NotebookPen,
  Pause,
  Phone,
  PhoneOff,
  Play,
  Radio,
  RotateCcw,
  SkipForward,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Avatar } from "@/components/ui/avatar";
import { Button, buttonVariants } from "@/components/ui/button";
import type { AiLockReason } from "@/lib/org/settings";
import type { CallOutcome, Lead } from "@/lib/types";
import type { DialerState, KnownInfo } from "@/lib/use-dialer";
import { cn, formatDuration, formatPhone, initials } from "@/lib/utils";
import { AiSessionView } from "./ai-session-view";
import { CallerIdPicker } from "./caller-id-picker";
import { DialPad } from "./dial-pad";
import { KnownInfoDialog } from "./known-info-dialog";
import { ParallelLanes } from "./parallel-lanes";
import { Waveform } from "./waveform";
import { WrapupPanel } from "./wrapup-panel";

// ─────────────────────────────────────────────────────────────────────────────
// CallCockpit (E4) — call-stage.tsx, dissolved. This file is now only the
// conductor for the dialer's center column: the session bar (caller-ID picker,
// auto-dial pause, reconnect, line badge) plus one block per engine status —
//   idle    → the idle cockpit (kept here; mode SWITCHING moved to the E3
//             ShellHeader, so the old duplicate AI/Manual bar is gone)
//   ai      → AiSessionView       (per-call rows, live pills, transcript)
//   dialing → ParallelLanes       (a single dial is a parallel-of-one lane)
//   live    → the E3 manual cockpit, with the released rail beneath it on a
//             parallel round and one-tap reach to the script & notes
//   wrapup  → WrapupPanel (E3)
// Session dial/connect counters left this bar — the ShellHeader directly above
// shows the same numbers, and two copies an inch apart is one copy too many.
// ─────────────────────────────────────────────────────────────────────────────

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
  disabled,
  title,
}: {
  active?: boolean;
  onClick: () => void;
  icon: typeof Mic;
  activeIcon?: typeof Mic;
  label: string;
  danger?: boolean;
  /** Render disabled — pair with `title` naming the plain-language reason. */
  disabled?: boolean;
  title?: string;
}) {
  const Display = active && ActiveIcon ? ActiveIcon : Icon;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "flex flex-col items-center gap-1.5",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {/* Mute / hold / keypad — pressed mid-call, mid-sentence. Colour is the
          whole state channel: the button used to shrink 10% on press, paint a
          20px red halo when muted (an arbitrary shadow outside the three-token
          elevation ladder), and sit on a 60%-alpha surface with a blur behind
          its own glyph. */}
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full border transition-colors duration-[var(--dur-state)]",
          active
            ? danger
              ? "border-danger bg-danger text-danger-foreground"
              : "border-primary/60 bg-primary-soft text-primary"
            : cn(
                "border-border/70 bg-surface text-foreground",
                !disabled && "hover:bg-muted",
              ),
        )}
      >
        <Display className="h-5 w-5" />
      </span>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
    </button>
  );
}

/** High-contrast muted pill + polite announcement — dialing AND live views. */
function MuteStatus({ muted }: { muted: boolean }) {
  return (
    <>
      <span aria-live="polite" className="sr-only">
        {muted ? "Microphone muted" : "Microphone live"}
      </span>
      {muted && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-danger px-3 py-1 text-xs font-bold text-danger-foreground">
          <MicOff className="h-3.5 w-3.5" />
          Muted
        </span>
      )}
    </>
  );
}

/** One-tap reach into the right column: the script and the notes are always on
 *  the page, but on a laptop mid-call they can be below the fold — these
 *  scroll/focus them rather than duplicating either surface here. */
function ReachBar() {
  return (
    <div className="flex items-center justify-center gap-2">
      <button
        type="button"
        onClick={() =>
          document
            .querySelector<HTMLElement>("[data-dialer-teleprompter]")
            ?.scrollIntoView({ behavior: "smooth", block: "start" })
        }
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <MessageSquareText className="h-3 w-3" />
        Script
      </button>
      <button
        type="button"
        onClick={() => document.querySelector<HTMLElement>("[data-dialer-notes]")?.focus()}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <NotebookPen className="h-3 w-3" />
        Notes
      </button>
    </div>
  );
}

export function CallCockpit({
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
  callerIdPool = [],
  callerIdRotateEvery = 1,
  onToggleExcludedCallerId,
  onStart,
  onManualDial,
  onAiDialNumber,
  onEnd,
  onSkip,
  onRedial,
  onOutcome,
  onToggleMute,
  onToggleHold,
  onDigit,
  onSetParallel,
  onSetAutoDial,
  onLaunchNextAI,
  onStopAICampaign,
  onEndAISession,
  onReconnect,
  keypadOpen,
  onToggleKeypad,
  manualPadOpen,
  onToggleManualPad,
  wrapupNotes,
  onNotesChange,
  dispositions,
  allowedDispositionKeys,
  reviewEnabled = false,
}: {
  state: DialerState;
  focusLead: Lead | null;
  hasQueue: boolean;
  /** The in-call DTMF pad. Lifted out of this component so the "#" shortcut,
   *  which is registered on the page above, can open the same one the Keypad
   *  button does. */
  keypadOpen: boolean;
  onToggleKeypad: () => void;
  /** The idle "dial a specific number" pad — the other thing "#" reveals. */
  manualPadOpen: boolean;
  onToggleManualPad: () => void;
  /** The rep's in-call notes at wrap-up — evidence for the AI summary. */
  wrapupNotes?: string;
  /** Edit those notes from the wrap-up screen — same note the qualify panel shows. */
  onNotesChange?: (notes: string) => void;
  aiConfigured: boolean;
  manualEnabled?: boolean;
  aiEnabled?: boolean;
  aiLockReason?: AiLockReason;
  /** A distinct second AI agent is configured — shows the agent picker in AI mode. */
  secondAgentConfigured?: boolean;
  /** Display labels for the two AI agents. */
  agentNames?: { primary: string; secondary: string };
  onSetActiveAgent?: (agent: "primary" | "secondary") => void;
  /** The org's effective caller-ID rotation pool — powers the picker below. */
  callerIdPool?: string[];
  callerIdRotateEvery?: number;
  onToggleExcludedCallerId: (callerId: string) => void;
  onStart: () => void;
  onManualDial: (number: string, name?: string) => void;
  onAiDialNumber: (phone: string, known: KnownInfo) => void;
  onEnd: () => void;
  onSkip: () => void;
  /** Re-dial the lead on the wrap-up screen right now, same caller ID, no
   *  disposition filed — see the button's inline comment for why. */
  onRedial: () => void;
  /** Fires with the canonical outcome to store AND the disposition-def key
   *  the rep actually pressed (an `x_*` key for admin-created buttons). */
  onOutcome: (o: CallOutcome, dispositionKey?: string) => void;
  /** The org's stored `settings.dispositions` — the wrap-up grid renders the
   *  admin's own taxonomy. Absent ⇒ the canonical nine. */
  dispositions?: unknown;
  /** The active campaign's `disposition_keys` subset (empty/absent = all). */
  allowedDispositionKeys?: string[];
  /** Wrap-up "Flag for review" works (false = demo, disabled with a reason). */
  reviewEnabled?: boolean;
  onToggleMute: () => void;
  onToggleHold: () => void;
  onDigit: (d: string) => void;
  onSetParallel: (n: number) => void;
  onSetAutoDial: (b: boolean) => void;
  onLaunchNextAI: () => void;
  onStopAICampaign: () => void;
  onEndAISession: () => void;
  onReconnect: () => void;
}) {
  const [pendingAiNumber, setPendingAiNumber] = useState<string | null>(null);
  const vocab = useVocabulary();
  // AI is usable only when configured AND permitted for this viewer; mode
  // SWITCHING lives in the ShellHeader (E3) — this file only reads the mode.
  const aiUsable = aiConfigured && aiEnabled;
  const ai = state.aiMode && aiUsable;
  // A registered Twilio Device is NOT the same as a usable one. Registration
  // needs no microphone, so a rep whose mic is blocked saw "Twilio Live", a live
  // Start button, and a contact rung into silence on every press. Manual
  // dialing needs both.
  const micBlocked = !ai && state.micBlocked;
  const canCall = state.mode === "live" && !micBlocked;
  const canStart = ai ? hasQueue : canCall && Boolean(focusLead);
  const name = focusLead ? `${focusLead.firstName} ${focusLead.lastName}` : "No lead";
  const aiLockText =
    aiLockReason === "role"
      ? "The AI dialer is available to admins and managers."
      : "AI dialing is a premium feature on this plan.";

  const modeBadge = ai
    ? { label: "AI agent ready", cls: "bg-accent-soft text-accent" }
    : micBlocked
      ? { label: "Mic blocked", cls: "bg-danger/10 text-danger" }
      : state.mode === "live"
        ? { label: "Twilio Live", cls: "bg-success/10 text-success" }
        : state.mode === "offline"
          ? { label: "Twilio offline", cls: "bg-danger/10 text-danger" }
          : { label: "Connecting…", cls: "bg-muted text-muted-foreground" };

  // A parallel round keeps its losing lanes on screen through the live view —
  // the released rail under the cockpit (compose, don't duplicate).
  const parallelRound = state.lines.length > 1;

  return (
    <div className="flex h-full flex-col">
      {/* Session bar — the interactive per-session controls. The dial/connect
          counters moved to the ShellHeader; this bar keeps what you can TOUCH. */}
      <div className="flex flex-wrap items-center justify-between gap-y-1.5 border-b border-border px-5 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-semibold">
            <Radio className="h-4 w-4 text-primary" />
            Session
          </span>
          {/* Caller-ID picker — toggle pool numbers in/out of rotation */}
          <CallerIdPicker
            pool={callerIdPool}
            rotateEvery={callerIdRotateEvery}
            excludedCallerIds={state.excludedCallerIds}
            active={state.callerIdInfo}
            disabled={state.status !== "idle"}
            onToggle={onToggleExcludedCallerId}
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Pause auto-dial mid-session. AI mode already has this — the "Stop
              auto-dial" / "Call next" pair in AiSessionView — so this is
              manual-mode only, and only while a call is actually in flight
              (dialing/live/wrapup). Toggling it off doesn't touch the CURRENT
              call; it only stops the next one from auto-starting once this one
              ends. Turning it back on before this call ends un-pauses in place
              — selectOutcome()/skip() re-check autoDial when they run. Once the
              call fully ends while paused, status returns to "idle" and the
              rep lands on the ordinary "Ready to dial" screen, toggle already
              off — that IS the resume UI, so no separate one is needed here. */}
          {!ai && state.status !== "idle" && (
            <button
              type="button"
              onClick={() => onSetAutoDial(!state.autoDial)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors duration-[var(--dur-state)]",
                state.autoDial
                  ? "border-border bg-surface text-foreground hover:bg-muted"
                  : "border-warning/40 bg-warning/10 text-warning hover:bg-warning/15",
              )}
              title={
                state.autoDial
                  ? "Stop auto-dialing after this call — you'll land back on the Start screen instead of moving to the next lead."
                  : "Auto-dial is paused — the next call won't start on its own. Tap to un-pause."
              }
            >
              {state.autoDial ? (
                <Pause className="h-3 w-3" />
              ) : (
                <Play className="h-3 w-3" />
              )}
              {state.autoDial ? "Pause auto-dial" : "Auto-dial paused"}
            </button>
          )}
          {/* When the device drops (token lapse, network blip, Safari quirk) the
              rep gets a one-tap recovery instead of having to reload — reloading
              didn't reliably fix it. A blocked mic gets the same tap: onReconnect
              re-runs setupDevice, which re-requests microphone permission. */}
          {(state.mode === "offline" || micBlocked) && (
            <button
              type="button"
              onClick={onReconnect}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors duration-[var(--dur-state)] hover:bg-muted"
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
        {/* Not `mode="wait"`. It held the incoming block until the outgoing
            one finished, so on pickup the rep's screen was still mid-transition
            while a stranger was saying hello. */}
        <AnimatePresence>
          {/* ── IDLE — the idle cockpit ──────────────────────────── */}
          {state.status === "idle" && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex w-full max-w-sm flex-col items-center gap-6"
            >
              {/* Agent picker — which AI persona to dial as. Only meaningful in AI
                  mode and only when a second agent is actually configured. */}
              {ai && secondAgentConfigured && onSetActiveAgent && (
                <div className="flex flex-col items-center gap-1.5">
                  <div className="inline-flex rounded-xl border border-border bg-card p-1">
                    {(["primary", "secondary"] as const).map((key) => {
                      const active = state.activeAgent === key;
                      const label =
                        key === "primary"
                          ? agentNames?.primary || "Agent 1"
                          : agentNames?.secondary || "Agent 2";
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => onSetActiveAgent(key)}
                          className={cn(
                            "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-semibold transition-colors",
                            active
                              ? "bg-brand text-white shadow-soft"
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
                {/* Still. The idle cockpit reads as a Stage moment — "ready to
                    dial" — but it is a PANEL inside the working screen, sharing
                    it with the queue toolbar and the live floor, not a
                    full-screen state. A 7-second float loop under a rep's eye
                    for the whole time they are between calls is decoration on
                    the working surface. */}
                <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-brand">
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
                        ? `The AI agent will call ${state.parallelCount} ${vocab.leadNounPlural} at once. Oversee them in the Live Monitor.`
                        : "The AI agent dials, qualifies & books — you oversee from the Live Monitor."
                      : state.parallelCount > 1
                        ? `${state.parallelCount} lines will ring at once. First answer connects instantly.`
                        : "Single-line power dialing through your queue."}
                </p>
                {/* Mode locks still say WHY when a mode is gated — the switcher
                    itself lives in the header above. */}
                {!aiEnabled && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{aiLockText}</p>
                )}
                {!manualEnabled && (
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    Manual dialing is a premium feature on this plan.
                  </p>
                )}
              </div>

              {hasQueue && (
                <>
                  {/* A ceiling of one line is not a choice — the org has turned
                      parallel dialing off, so don't render a lone "1X" chip. */}
                  {state.maxParallel > 1 && (
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
                              "rounded-xl border py-2.5 text-sm font-bold transition-colors duration-[var(--dur-state)]",
                              state.parallelCount === n
                                ? "border-primary/60 bg-primary-soft text-primary"
                                : "border-border/70 bg-surface text-muted-foreground hover:bg-muted",
                            )}
                          >
                            {n}X
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <label className="flex w-full cursor-pointer items-center justify-between rounded-xl border border-border/70 bg-surface px-4 py-3">
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

                  {/* Say WHY Start is unavailable. A dead button with no
                      explanation is what "I click it and nothing happens" looks
                      like from the rep's chair. */}
                  {micBlocked && (
                    <div className="w-full rounded-xl border border-danger/30 bg-danger/5 p-3">
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-danger">
                        <MicOff className="h-4 w-4 shrink-0" />
                        Microphone blocked
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Twilio is connected, but this tab can&apos;t use your microphone — so a
                        call would ring the {vocab.leadNoun} with no one on the line. Allow
                        microphone access for this site in your browser, then press{" "}
                        <b className="text-foreground">Reconnect</b> above.
                      </p>
                    </div>
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
                    onClick={onToggleManualPad}
                    className="mx-auto mb-3 flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                  >
                    <Hash className="h-4 w-4" />
                    {manualPadOpen ? "Hide number pad" : "Dial a specific number"}
                  </button>
                )}
                <AnimatePresence initial={false}>
                  {manualPadOpen && (
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
            <AiSessionView
              calls={state.aiCalls}
              campaign={state.aiCampaign}
              parallelCount={state.parallelCount}
              hasMore={hasQueue}
              onLaunchNext={onLaunchNextAI}
              onStop={onStopAICampaign}
              onEnd={onEndAISession}
            />
          )}

          {/* ── DIALING — the parallel workspace (1X = one lane) ──── */}
          {state.status === "dialing" && (
            <motion.div
              key="dialing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex w-full max-w-md flex-col gap-5"
            >
              <div className="text-center">
                <p className="text-sm font-semibold text-warning">
                  Dialing {state.lines.length} line{state.lines.length > 1 ? "s" : ""}…
                </p>
                <p className="text-xs text-muted-foreground">
                  Connecting you to the first {vocab.leadNoun} who answers
                </p>
              </div>
              <ParallelLanes lines={state.lines} />
              {/* PRE-ANSWER MUTE — the rep's leg joins the conference the
                  moment connect() resolves, BEFORE the customer answers, so
                  mute is real from here on. A press in the sub-second window
                  before connect resolves is queued and applied on arrival
                  (muteCapability "arming"); demo/unconfigured can't reach this
                  screen, but the control still disables honestly if it could. */}
              <div className="flex items-center justify-center gap-3">
                <ControlButton
                  label={state.muted ? "Unmute" : "Mute"}
                  icon={Mic}
                  activeIcon={MicOff}
                  active={state.muted}
                  onClick={onToggleMute}
                  disabled={state.muteCapability === "unsupported"}
                  title={
                    state.muteCapability === "unsupported"
                      ? "Muting isn't available — there's no live line to mute in this setup."
                      : state.muteCapability === "arming"
                        ? "Your line is joining — the mute takes effect the instant it does."
                        : "Mute your microphone before anyone answers (m)"
                  }
                />
                <MuteStatus muted={state.muted} />
              </div>
              <Button variant="outline" className="w-full gap-2" onClick={onSkip}>
                <PhoneOff className="h-4 w-4" />
                Cancel
              </Button>
            </motion.div>
          )}

          {/* ── LIVE — the E3 manual cockpit; the answered lane, expanded ── */}
          {state.status === "live" && focusLead && (
            <motion.div
              key="live"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex w-full max-w-sm flex-col items-center gap-5"
            >
              {/* A live call is a state, not an event. This carried a 72px
                  blurred green orb breathing on a 4s loop and a halo expanding
                  out of it every 1.8s, for the whole duration of every call —
                  four minutes or forty — behind the face of the person the rep
                  is talking to. The ring says "live" once and then holds
                  still; the beat belongs to the moment of pickup. */}
              <span className="relative">
                {/* The connect beat. One 240ms ring, keyed on the pickup
                    timestamp so it replays on every call rather than once per
                    mount, and gone before the rep has finished registering it.
                    This is the phase's single sanctioned crossing between the
                    Stage and the Instrument. */}
                <span
                  key={state.connectedAt ?? "live"}
                  className="animate-connect pointer-events-none absolute inset-0 rounded-full"
                  aria-hidden
                />
                <Avatar
                  initials={initials(name)}
                  tone="success"
                  size="lg"
                  className="relative h-24 w-24 text-3xl ring-2 ring-success"
                />
                <span
                  className="absolute -bottom-0.5 -right-0.5 h-5 w-5 rounded-full border-2 border-card bg-success"
                  aria-hidden
                />
              </span>
              <div className="text-center">
                <h2 className="text-2xl font-bold">{name}</h2>
                <p className="text-sm text-muted-foreground">
                  {focusLead.city ? `${focusLead.city}, ${focusLead.state}` : "Manual call"}
                </p>
                {state.callerIdInfo?.callerId && (
                  <p className="mt-0.5 flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    Dialing from {formatPhone(state.callerIdInfo.callerId)}
                    {state.callerIdInfo.localPresence ? " — local to them" : ""}
                  </p>
                )}
                <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-success/10 px-3 py-1 text-sm font-bold text-success tabular">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  {formatDuration(state.durationSec)}
                  {state.onHold && <span className="text-warning">· On hold</span>}
                  {state.recording && (
                    // Static. Tailwind's `pulse` bottoms out at opacity .5,
                    // which takes this dot to ~2.2:1 against its pill — under
                    // the 3:1 floor for a non-text indicator — every second.
                    // And the fact does not change: the call is being recorded
                    // for its whole duration.
                    <span className="flex items-center gap-1 text-danger">
                      · <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden /> REC
                    </span>
                  )}
                </div>
                {state.reconnecting && (
                  <p className="mt-1.5 flex items-center justify-center gap-1.5 text-xs font-semibold text-warning">
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />
                    Reconnecting — hold on, the call is still connected
                  </p>
                )}
              </div>

              <Waveform
                active={!state.onHold}
                muted={state.muted}
                className="w-full max-w-[280px]"
              />

              <AnimatePresence>
                {keypadOpen && (
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

              {/* The Record toggle is GONE: it flipped a client boolean that
                  controlled nothing. Recording is org policy — the REC chip
                  above reflects what the rep leg actually asked Twilio for. */}
              <MuteStatus muted={state.muted} />
              <div className="flex items-center justify-center gap-5">
                <ControlButton label={state.muted ? "Unmute" : "Mute"} icon={Mic} activeIcon={MicOff} active={state.muted} onClick={onToggleMute} title="Mute your microphone (m)" />
                <ControlButton label="Keypad" icon={Grid3x3} active={keypadOpen} onClick={onToggleKeypad} title="Show the keypad (#)" />
                <ControlButton label={state.onHold ? "Resume" : "Hold"} icon={Pause} activeIcon={Play} active={state.onHold} onClick={onToggleHold} />
              </div>

              <ReachBar />

              <Button variant="danger" size="lg" className="w-full gap-2" onClick={onEnd}>
                <PhoneOff className="h-5 w-5" />
                End call
              </Button>

              {/* The losing lanes of a parallel round — collapsed, honest, with
                  their release reasons (the same component, rail variant). */}
              {parallelRound && (
                <ParallelLanes variant="rail" lines={state.lines} className="w-full" />
              )}
            </motion.div>
          )}

          {/* ── WRAP-UP ──────────────────────────────────────────── */}
          {/* Consolidated into WrapupPanel (E3): taxonomy grid, notes, AI
              summary, crash-safe draft, flag-for-review — one surface. */}
          {state.status === "wrapup" && (
            <motion.div
              key="wrapup"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="w-full max-w-md"
            >
              <WrapupPanel
                leadName={name}
                lead={focusLead}
                durationSec={state.durationSec}
                attemptId={
                  (focusLead ? state.attemptIds[focusLead.id] : null) ?? state.callSid
                }
                notes={wrapupNotes}
                onNotesChange={onNotesChange}
                onOutcome={onOutcome}
                dispositions={dispositions}
                allowedKeys={allowedDispositionKeys}
                onRedial={onRedial}
                onSkip={onSkip}
                reviewEnabled={reviewEnabled}
              />
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
