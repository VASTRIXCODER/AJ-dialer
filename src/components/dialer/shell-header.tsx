"use client";

import {
  Bot,
  Circle,
  Hash,
  Keyboard,
  ListFilter,
  Lock,
  Mic,
  MicOff,
  Phone,
  Rows3,
} from "lucide-react";
import { useMemo, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { RealtimeHealth } from "@/components/ui/realtime-health";
import { Tab, TabList, Tabs } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { useDialerDevices } from "@/lib/dialer/use-dialer-devices";
import type { PresencePayload } from "@/lib/realtime/events";
import { useOrgChannel } from "@/lib/realtime/use-org-channel";
import type { DialerStatus, SessionMode } from "@/lib/use-dialer";
import { MAX_PARALLEL_HUMAN } from "@/lib/use-dialer";
import { cn } from "@/lib/utils";
import { AudioDeviceMenu } from "./audio-device-menu";
import { useDialerContext } from "./dialer-context";

// ─────────────────────────────────────────────────────────────────────────────
// The dialer command center's header (E3): explicit mode switcher, assignment/
// campaign scope with progress, the line-readiness cluster (device, mic,
// caller IDs, audio devices, recording policy), realtime channel health with
// LIVE presence on the org floor, session stats, and the shortcut overlay
// trigger. Everything here DERIVES from engine state — no new state machines.
// ─────────────────────────────────────────────────────────────────────────────

/** DialerStatus → what the floor's presence roster understands. */
function presenceStatus(status: DialerStatus): PresencePayload["status"] {
  switch (status) {
    case "dialing":
    case "live":
      return "dialing";
    case "wrapup":
      return "wrapup";
    case "ai":
      return "ai";
    default:
      return "available";
  }
}

const MODE_LABEL: Record<SessionMode, string> = {
  manual: "Manual",
  parallel: "Parallel",
  ai: "AI",
};

/**
 * Honest recording chip — bound to ORG POLICY (settings.dialing.recording),
 * which is exactly what the rep leg passes to Twilio's conference record flag.
 * There is deliberately no toggle: the old one flipped a boolean that
 * controlled nothing while the connect param stayed hardcoded.
 */
export function RecordingIndicator({
  recording,
  /**
   * Which channel is placing calls. This matters because `recording` is ONLY
   * the Twilio conference record flag — the org's manual-dialing policy. The AI
   * agent records every conversation it holds regardless of that flag; the
   * product plays those recordings back in Reports and in Monitor
   * (/api/elevenlabs/audio/[id]). So an AI-mode workspace with conference
   * recording switched off used to show a confident "Not recording" chip above
   * calls that were, in fact, all being recorded.
   */
  channel = "manual",
}: {
  recording: boolean;
  channel?: "manual" | "ai";
}) {
  const on = channel === "ai" ? true : recording;
  const content =
    channel === "ai"
      ? "The AI agent records every call it places, and those recordings are playable in Reports and Monitor. This is separate from your organization's conference-recording policy for manual calls."
      : on
        ? "Calls are recorded — your organization's policy (Admin → Dialing). Reps can't switch this off per call."
        : "Calls are NOT recorded — your organization's policy (Admin → Dialing).";
  const label =
    channel === "ai"
      ? "Recording on — the AI agent"
      : on
        ? "Recording on — org policy"
        : "Not recording";

  return (
    <Tooltip content={content}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
          on
            ? "border-danger/30 bg-danger/10 text-danger"
            : "border-border bg-surface text-muted-foreground",
        )}
      >
        <Circle
          className={cn("h-2 w-2", on ? "fill-danger" : "fill-muted-foreground/40")}
          strokeWidth={0}
        />
        {label}
      </span>
    </Tooltip>
  );
}

/** A small readiness pill with a tooltip explanation. */
function ReadyPill({
  tone,
  label,
  explain,
  icon: Icon,
}: {
  tone: "success" | "warning" | "danger" | "neutral";
  label: string;
  explain: string;
  icon?: typeof Mic;
}) {
  const toneCls =
    tone === "success"
      ? "border-success/30 bg-success/10 text-success"
      : tone === "warning"
        ? "border-warning/30 bg-warning/10 text-warning"
        : tone === "danger"
          ? "border-danger/30 bg-danger/10 text-danger"
          : "border-border bg-surface text-muted-foreground";
  return (
    <Tooltip content={explain}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
          toneCls,
        )}
      >
        {Icon ? <Icon className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
        {label}
      </span>
    </Tooltip>
  );
}

export function ShellHeader({
  assignmentLabel,
  onOpenKbd,
}: {
  assignmentLabel?: string;
  onOpenKbd: () => void;
}) {
  const { dialer, config, queueForDialer, campaignFilter, campaigns } = useDialerContext();
  const { state } = dialer;

  // ── Realtime: channel health + LIVE presence for the floor ────────────────
  // The dialer self-reports its status on the org channel while this page is
  // mounted; webhook-driven call state always beats this claim on the floor
  // (floor-merge), so presence can only ever make the roster MORE alive.
  const status = presenceStatus(state.status);
  const sinceRef = useRef<{ status: string; at: number }>({ status, at: Date.now() });
  if (sinceRef.current.status !== status) sinceRef.current = { status, at: Date.now() };
  const statusSince = sinceRef.current.at;
  const track = useMemo<PresencePayload | null>(
    () =>
      config.userId
        ? {
            userId: config.userId,
            name: config.displayName || "Rep",
            status,
            statusSince,
            mode: state.sessionMode,
          }
        : null,
    [config.userId, config.displayName, status, statusSince, state.sessionMode],
  );
  const { health } = useOrgChannel({ orgId: config.orgId ?? null, track });

  // ── Audio devices (line-readiness cluster) ────────────────────────────────
  const devices = useDialerDevices(dialer.getDevice, state.mode, config.userId);

  // ── Mode gating — the same rules CallStage applies today ─────────────────
  const aiUsable = config.aiAgentConfigured && config.aiEnabled;
  const manualEnabled = config.manualEnabled;
  const aiOffForWorkspace = config.aiLockReason === "premium" && manualEnabled;
  const aiLockText =
    config.aiLockReason === "role"
      ? "The AI dialer is available to admins and managers."
      : "AI dialing is a premium feature on this plan.";
  const humanCeiling = Math.max(
    1,
    Math.min(MAX_PARALLEL_HUMAN, config.maxHumanLines ?? MAX_PARALLEL_HUMAN),
  );
  const busy = state.status !== "idle";

  // ── Scope + progress ──────────────────────────────────────────────────────
  const campaignName = campaignFilter
    ? campaigns.find((c) => c.id === campaignFilter)?.name ?? "Campaign"
    : null;
  const total = queueForDialer.length;
  const position = total ? (state.queueIndex % total) + 1 : 0;

  // ── Caller-ID readiness (the interactive picker stays in the call stage) ──
  const pool = config.callerIdPool ?? [];
  const excluded = state.excludedCallerIds.filter((n) => pool.includes(n)).length;
  const enabledIds = pool.length - excluded;

  const ai = state.aiMode && aiUsable;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-border bg-card px-4 py-3 shadow-soft">
      {/* Mode switcher — one word for what this session IS. Switching resets
          the engine's mode knobs together (setSessionMode), so it's only
          offered between calls; mid-call the current mode shows as a fact. */}
      {busy ? (
        <Badge tone="primary" className="gap-1.5" title="Finish the current call to switch modes.">
          {state.sessionMode === "ai" ? (
            <Bot className="h-3.5 w-3.5" />
          ) : state.sessionMode === "parallel" ? (
            <Rows3 className="h-3.5 w-3.5" />
          ) : (
            <Hash className="h-3.5 w-3.5" />
          )}
          {MODE_LABEL[state.sessionMode]} session
        </Badge>
      ) : (
        <Tabs value={state.sessionMode} onChange={(v) => dialer.setSessionMode(v as SessionMode)}>
          <TabList label="Dialing mode">
            {manualEnabled ? (
              <Tab value="manual" className="flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5" />
                Manual
              </Tab>
            ) : (
              <span
                title="Manual dialing is a premium feature — locked on this plan."
                className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-3"
              >
                <Lock className="h-3.5 w-3.5" />
                Manual
              </span>
            )}
            {manualEnabled && humanCeiling > 1 && (
              <Tab value="parallel" className="flex items-center gap-1.5">
                <Rows3 className="h-3.5 w-3.5" />
                Parallel
              </Tab>
            )}
            {aiUsable ? (
              <Tab value="ai" className="flex items-center gap-1.5">
                <Bot className="h-3.5 w-3.5" />
                AI
              </Tab>
            ) : (
              // A locked AI mode still shows WHEN actionable ("ask your
              // manager") — but an org with AI off entirely gets no dead chip
              // advertising a feature this workspace doesn't have.
              !aiOffForWorkspace && (
                <span
                  title={aiLockText}
                  className="flex cursor-not-allowed items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-3"
                >
                  <Lock className="h-3.5 w-3.5" />
                  AI
                </span>
              )
            )}
          </TabList>
        </Tabs>
      )}

      {/* Assignment / campaign scope + progress through the loaded queue */}
      {assignmentLabel && (
        <Badge
          tone="primary"
          className="max-w-[220px] gap-1"
          title={`This queue is scoped to the assignment "${assignmentLabel}".`}
        >
          <ListFilter className="h-3 w-3 shrink-0" />
          <span className="truncate">Working: {assignmentLabel}</span>
        </Badge>
      )}
      {campaignName && (
        <Badge tone="accent" className="max-w-[180px] gap-1" title="Queue filtered to this campaign.">
          <span className="truncate">{campaignName}</span>
        </Badge>
      )}
      {total > 0 && (
        <span
          className="text-xs font-medium text-muted-foreground tabular"
          title="Your position in the loaded queue."
        >
          <b className="text-foreground">{position}</b> of {total}
        </span>
      )}

      <span className="flex-1" />

      {/* Session stats — client-side facts, honestly labeled */}
      <span className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>
          <b className="font-bold text-foreground tabular">{state.callsThisSession}</b> dials
        </span>
        {!ai && (
          <span>
            <b className="font-bold text-foreground tabular">{state.connectsThisSession}</b> connects
          </span>
        )}
        <span className="text-[11px] text-ink-3">this session</span>
        {state.dialsToday > 0 && (
          <span title="All your dials today, across sessions and reloads.">
            <b className="font-bold text-foreground tabular">{state.dialsToday}</b> today
          </span>
        )}
      </span>

      {/* Line-readiness cluster */}
      <span className="flex flex-wrap items-center gap-1.5">
        {ai ? (
          <ReadyPill
            tone="success"
            label="AI line"
            explain="The AI agent places calls server-side — no browser line or microphone needed."
            icon={Bot}
          />
        ) : state.micBlocked ? (
          <ReadyPill
            tone="danger"
            label="Mic blocked"
            explain="This tab can't use your microphone, so a call would ring with no one on the line. Allow microphone access, then press Reconnect."
            icon={MicOff}
          />
        ) : state.mode === "live" ? (
          <ReadyPill
            tone="success"
            label="Line ready"
            explain="Twilio is registered and your microphone works — calls can be placed."
            icon={Mic}
          />
        ) : state.mode === "offline" ? (
          <ReadyPill
            tone="danger"
            label="Line offline"
            explain="Twilio isn't connected. Add credentials (Admin) or press Reconnect on the call stage."
            icon={MicOff}
          />
        ) : (
          <ReadyPill
            tone="warning"
            label="Connecting"
            explain="Registering with Twilio — hold on."
            icon={Mic}
          />
        )}
        {pool.length > 0 && (
          <ReadyPill
            tone={enabledIds > 0 ? "neutral" : "warning"}
            label={pool.length > 1 ? `${enabledIds}/${pool.length} caller IDs` : "1 caller ID"}
            explain={
              pool.length > 1
                ? `${enabledIds} of ${pool.length} pool numbers are in rotation. Toggle numbers in the session bar's "Dial from" row.`
                : "One outbound caller ID is configured for this workspace."
            }
            icon={Phone}
          />
        )}
        <AudioDeviceMenu devices={devices} />
        <RecordingIndicator recording={state.recording} channel={state.aiMode ? "ai" : "manual"} />
        <RealtimeHealth health={health} />
      </span>

      {/* Keyboard shortcuts — the [?] key opens the same overlay */}
      <button
        type="button"
        onClick={onOpenKbd}
        title="Keyboard shortcuts (?)"
        aria-label="Show keyboard shortcuts"
        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-surface text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <Keyboard className="h-4 w-4" />
      </button>
    </div>
  );
}
