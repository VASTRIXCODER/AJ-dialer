"use client";

import { Bot, ExternalLink, Mic, MicOff, PhoneOff, Radio, Square } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Avatar } from "@/components/ui/avatar";
import { cn, formatDuration, initials, leadDisplayName } from "@/lib/utils";
import { useDialerContext } from "./dialer-context";
import { Z } from "@/lib/z-layers";

/**
 * Floating call bar shown on EVERY app page (except the dialer itself) whenever
 * work is in progress — so a rep can wander to Leads / Reports / anywhere
 * without the call dropping, and still see and control it. Backed by the
 * app-wide DialerProvider, so this is the same live call, not a copy.
 *
 * It is an Instrument surface — the one control a rep reaches for when a
 * stranger is on the line — so it does not move, glow or shrink. It appears and
 * disappears on opacity alone. (It used to enter with a 24px slide, sit on a
 * level-3 drop shadow, and scale its hang-up button on press.)
 *
 * It publishes its own height as `--callbar-h` while it is up. The bar is
 * `position: fixed`, so without that the last row of every table and the
 * bottom buttons of every form sat underneath it, unclickable, for the whole
 * call — and on a narrow window a toast landed squarely on End call.
 */

/** What the bar occupies, including its bottom offset. Read by the shell. */
const BAR_HEIGHT_PX = 68;

export function GlobalCallBar() {
  const { dialer, config } = useDialerContext();
  const { state } = dialer;
  const pathname = usePathname();
  const vocab = useVocabulary();

  // "ai" is a first-class running status, not a lull: the agent is placing
  // calls under this rep's identity. Leaving it out of this list meant an AI
  // campaign became completely invisible — and unstoppable — the moment the
  // rep walked to another page.
  const inProgress = state.status !== "idle";
  // The full dialer page already shows everything — no need for the floating
  // bar there.
  const hidden = !inProgress || pathname === "/dialer";

  // Reserve the space while the bar is up, and give it straight back. Cleared
  // on unmount too, so a hang-up never leaves a phantom gutter behind.
  useEffect(() => {
    if (hidden) return;
    const root = document.documentElement;
    root.style.setProperty("--callbar-h", `${BAR_HEIGHT_PX}px`);
    return () => {
      root.style.removeProperty("--callbar-h");
    };
  }, [hidden]);

  if (hidden) return null;

  const ai = state.status === "ai";
  const live = state.status === "live";
  const dialing = state.status === "dialing";
  const wrapup = state.status === "wrapup";

  const lead = state.connectedLead ?? state.lines[0]?.lead ?? null;
  const name = leadDisplayName(
    lead ? `${lead.firstName} ${lead.lastName}` : "",
    lead?.phone,
    vocab.leadNoun,
  );
  const agentName =
    state.activeAgent === "secondary"
      ? (config.agentNames?.secondary ?? "AI agent")
      : (config.agentNames?.primary ?? "AI agent");
  const running = state.aiCalls.filter((c) => !c.error).length;

  const statusLabel = ai
    ? `${running} ${running === 1 ? "call" : "calls"} running`
    : live
      ? formatDuration(state.durationSec)
      : dialing
        ? "Dialing…"
        : "Not filed yet";
  // Wrap-up is a TASK, not a status. It used to read as a grey word next to a
  // link called "Dialer", and calls sat undispositioned because nothing on
  // screen looked like it was waiting for the rep.
  const statusTone = live
    ? "text-success"
    : dialing || wrapup
      ? "text-warning"
      : ai
        ? "text-accent"
        : "text-muted-foreground";

  return (
    <div
      className="fixed inset-x-0 bottom-4 flex justify-center px-4 animate-fade-in"
      style={{ zIndex: Z.callBar }}
    >
      <div
        className={cn(
          "flex items-center gap-3 rounded-2xl border bg-surface-1 px-3 py-2 shadow-2",
          wrapup ? "border-warning/50" : "border-border/60",
        )}
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
          {ai ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <Bot className="h-4 w-4" />
            </span>
          ) : (
            <Avatar initials={initials(name)} tone="success" size="sm" />
          )}
          {live && (
            <>
              {/* The connect beat, on the surface a rep sees when they are NOT
                  on the dialer page. Until now, a rep working the Leads table
                  while a round rang got no signal at all that a homeowner had
                  picked up — they discovered it by noticing a number had
                  quietly started counting. */}
              <span
                key={state.connectedAt ?? "live"}
                className="animate-connect pointer-events-none absolute inset-0 rounded-full"
                aria-hidden
              />
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-success" />
            </>
          )}
        </span>
        {/* …and the beat a ring cannot deliver. Assertive: a stranger is on the
            line right now, which is the one interruption this app is entitled
            to make. */}
        <span aria-live="assertive" className="sr-only">
          {live ? `Connected to ${name}` : ""}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">{ai ? agentName : name}</p>
          <p className={cn("flex items-center gap-1 text-xs font-medium tabular", statusTone)}>
            <Radio className="h-3 w-3" aria-hidden />
            {statusLabel}
            {/* The rep is on a recorded call and is no longer looking at the
                dialer, where the only other REC indicator lives. Static — a
                blinking dot on this surface would be motion on the Instrument,
                and the fact does not change second to second. */}
            {live && state.recording && (
              <span className="ml-1 flex items-center gap-1 text-danger">
                <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden />
                REC
              </span>
            )}
          </p>
        </div>

        <div className="ml-1 flex items-center gap-1">
          {live && (
            <button
              type="button"
              onClick={dialer.toggleMute}
              aria-label={state.muted ? "Unmute" : "Mute"}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
                state.muted
                  ? "border-danger/50 bg-danger/10 text-danger"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {state.muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </button>
          )}
          {(live || dialing) && (
            <button
              type="button"
              onClick={live ? dialer.endCall : dialer.skip}
              aria-label="End call"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-danger bg-danger text-danger-foreground transition-colors hover:bg-danger/90"
            >
              <PhoneOff className="h-4 w-4" />
            </button>
          )}
          {ai && (
            <button
              type="button"
              onClick={dialer.endAISession}
              className="flex h-9 items-center gap-1.5 rounded-xl border border-danger bg-danger px-3 text-xs font-semibold text-danger-foreground transition-colors hover:bg-danger/90"
            >
              <Square className="h-3.5 w-3.5" aria-hidden />
              Stop
            </button>
          )}
          <Link
            href="/dialer"
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors",
              wrapup
                ? "border-warning bg-warning/10 text-warning hover:bg-warning/15"
                : "border-border hover:bg-muted",
            )}
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            {wrapup ? "Record the outcome" : "Dialer"}
          </Link>
        </div>
      </div>
    </div>
  );
}
