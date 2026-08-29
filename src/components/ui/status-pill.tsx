import type { LucideIcon } from "lucide-react";
import {
  Ban,
  Bot,
  Bookmark,
  CheckCircle2,
  CircleDot,
  CircleOff,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Minus,
  Pause,
  Phone,
  PhoneCall,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  TriangleAlert,
  Voicemail,
} from "lucide-react";
import type { AttemptState } from "@/lib/calls/state-machine";
import type { FloorStatus } from "@/lib/realtime/floor-merge";
import type { AILiveState, PresenceStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// StatusPill — THE single state → {icon, label, color} map for every live-call
// and presence state in the product.
//
// Before this, each monitor surface kept its own private map (and the raw
// state string leaked through in places), so the same call could read
// "Initiated" here and "Calling" there, in different colors. This map covers
// the UNION of the vocabularies a floor surface can encounter:
//   • the canonical AttemptState machine (docs/phase-1/call-state-machine.md)
//   • HumanCallState ("calling" — its other two words are shared)
//   • AILiveState  ("initiated"/"in_progress" — the rest are shared)
//   • PresenceStatus + the merged FloorStatus vocabulary (floor-merge.ts)
// Overlapping words ("ringing", "connected", "wrapup"…) get exactly ONE entry.
//
// Accessibility is the point: icon + label ALWAYS render — state is never
// conveyed by color alone — and the live pulse honors prefers-reduced-motion.
// ─────────────────────────────────────────────────────────────────────────────

export type PillState =
  | AttemptState
  | AILiveState
  | PresenceStatus
  | FloorStatus
  | "calling"; // HumanCallState's one word the others don't share

type PillTone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger";

export interface StatusPillMeta {
  icon: LucideIcon;
  label: string;
  tone: PillTone;
  /** A state that means "something is live on the phone right now". */
  live?: boolean;
}

/** Exported for reuse (sorting, tooltips, list cells) — the ONE map. */
export const statusPillMeta: Record<PillState, StatusPillMeta> = {
  // ── Canonical attempt machine ──────────────────────────────────────────────
  queued: { icon: Clock, label: "Queued", tone: "neutral" },
  reserved: { icon: Bookmark, label: "Reserved", tone: "neutral" },
  dialing: { icon: PhoneOutgoing, label: "Dialing", tone: "accent", live: true },
  ringing: { icon: PhoneCall, label: "Ringing", tone: "warning", live: true },
  human_connected: { icon: Phone, label: "Connected", tone: "success", live: true },
  voicemail_connected: { icon: Voicemail, label: "Voicemail", tone: "accent" },
  busy: { icon: PhoneMissed, label: "Busy", tone: "warning" },
  declined: { icon: PhoneOff, label: "Declined", tone: "danger" },
  no_answer: { icon: PhoneMissed, label: "No answer", tone: "neutral" },
  failed: { icon: TriangleAlert, label: "Failed", tone: "danger" },
  canceled: { icon: Ban, label: "Canceled", tone: "neutral" },
  wrap_up: { icon: ClipboardList, label: "Wrap-up", tone: "primary" },
  dispositioned: { icon: ClipboardCheck, label: "Dispositioned", tone: "primary" },
  completed: { icon: CheckCircle2, label: "Completed", tone: "success" },
  // ── Human/AI live-call words the machine doesn't use ───────────────────────
  calling: { icon: PhoneOutgoing, label: "Calling", tone: "accent", live: true },
  initiated: { icon: PhoneOutgoing, label: "Calling", tone: "accent", live: true },
  in_progress: { icon: Phone, label: "Connected", tone: "success", live: true },
  connected: { icon: Phone, label: "On call", tone: "success", live: true },
  // ── Presence / floor roster ────────────────────────────────────────────────
  idle: { icon: Minus, label: "Idle", tone: "neutral" },
  live: { icon: Phone, label: "On call", tone: "success", live: true },
  wrapup: { icon: ClipboardList, label: "Wrap-up", tone: "primary" },
  ai: { icon: Bot, label: "AI dialing", tone: "primary", live: true },
  available: { icon: CircleDot, label: "Available", tone: "accent" },
  paused: { icon: Pause, label: "Paused", tone: "warning" },
  offline: { icon: CircleOff, label: "Offline", tone: "neutral" },
};

const toneClasses: Record<PillTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  primary: "bg-primary-soft text-primary",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/12 text-danger",
};

export function StatusPill({
  state,
  size = "sm",
  pulse,
  showIcon = true,
  className,
}: {
  state: PillState;
  size?: "sm" | "md";
  /** Animate the live dot (defaults to the state's own liveness). */
  pulse?: boolean;
  showIcon?: boolean;
  className?: string;
}) {
  const meta = statusPillMeta[state] ?? statusPillMeta.idle;
  const Icon = meta.icon;
  const showPulse = pulse ?? Boolean(meta.live);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full font-semibold",
        size === "sm" ? "gap-1 px-2 py-0.5 text-[11px]" : "gap-1.5 px-2.5 py-1 text-xs",
        toneClasses[meta.tone],
        className,
      )}
    >
      {showIcon && (
        <span className="relative inline-flex shrink-0">
          <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
          {showPulse && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 inline-flex h-1.5 w-1.5 animate-ping rounded-full bg-current opacity-60 motion-reduce:hidden"
            />
          )}
        </span>
      )}
      {meta.label}
    </span>
  );
}
