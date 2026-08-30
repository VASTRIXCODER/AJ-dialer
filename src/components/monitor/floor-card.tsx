"use client";

import { Bot, Flag, Headphones, Loader2, PhoneOff, User } from "lucide-react";
import { LeadOpenLink } from "@/components/leads/lead-360/lead-open-link";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatusPill, type PillState } from "@/components/ui/status-pill";
import { cn, formatDuration, initials } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// FloorCard — one tile on the Live Floor: who, doing what, with whom, since
// when, and how trustworthy that picture is (last-event age → STALE badge).
// Controls follow the "never fake a capability" rule: a listen button that
// cannot work in the current state/config renders DISABLED with a plain-
// language reason in its title, not hidden and not broken-on-click.
// ─────────────────────────────────────────────────────────────────────────────

export interface FloorCardModel {
  key: string;
  /** A live call tile, or an idle roster tile (rep with no live call). */
  kind: "call" | "rep";
  mode: "manual" | "ai" | null;
  repUserId: string | null;
  repName: string;
  state: PillState;
  /** ms epoch — when `state` began (drives the ticking timer). */
  stateSince: number;
  /** ms epoch of the last signal about this call (null for roster tiles). */
  lastEventAt: number | null;
  stale: boolean;
  leadId: string | null;
  leadName: string;
  city: string;
  campaignName: string;
  callsToday: number;
  /** Roster tiles: AI lines currently in flight for this rep. */
  aiActiveCount: number;
  humanId?: string;
  conversationId?: string;
  /** Human calls: the conference exists (connected) → joinable muted. */
  canListenNow?: boolean;
}

export interface FloorCapabilities {
  humanListen: boolean;
  aiLiveAudio: boolean;
}

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

/** Why listen is unavailable, in words a supervisor can act on (null = it works). */
export function listenDisabledReason(
  card: FloorCardModel,
  canListen: boolean,
  caps: FloorCapabilities,
): string | null {
  if (!canListen) return "Your role can't listen in — ask an admin for the listen permission.";
  if (card.mode === "manual") {
    if (!caps.humanListen)
      return "Twilio voice credentials aren't configured, so live listening isn't available.";
    if (!card.canListenNow) return "You can listen once the call connects.";
    return null;
  }
  if (card.mode === "ai") {
    if (!caps.aiLiveAudio)
      return "Live AI audio needs a Twilio bridge number (TWILIO_AI_BRIDGE_NUMBER) or the media-stream relay.";
    return null;
  }
  return "No live call to listen to.";
}

export function FloorCard({
  card,
  now,
  canListen,
  canIntervene,
  capabilities,
  listening,
  listenBusy,
  onToggleListen,
  onEndAi,
  endBusy,
  onOpen,
  density = "comfortable",
}: {
  card: FloorCardModel;
  now: number;
  canListen: boolean;
  canIntervene: boolean;
  capabilities: FloorCapabilities;
  /** True when the supervisor is listening to THIS card's call. */
  listening: boolean;
  listenBusy: boolean;
  onToggleListen: (card: FloorCardModel) => void;
  onEndAi: (conversationId: string) => void;
  endBusy: boolean;
  onOpen: (card: FloorCardModel) => void;
  density?: "compact" | "comfortable";
}) {
  const isCall = card.kind === "call";
  const isAi = card.mode === "ai";
  const unattributed = !card.repUserId && isAi;
  const dur = Math.max(0, Math.floor((now - card.stateSince) / 1000));
  const listenReason = listenDisabledReason(card, canListen, capabilities);
  const compact = density === "compact";

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={() => onOpen(card)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(card);
        }
      }}
      className={cn(
        "cursor-pointer overflow-hidden text-left transition-shadow hover:shadow-lift",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        compact ? "p-3.5" : "p-5",
        isCall && card.state === "connected" && "ring-1 ring-success/25",
        isCall && card.state === "ringing" && "ring-1 ring-warning/30",
        card.stale && "ring-1 ring-warning/40",
      )}
    >
      {/* Who */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-3">
          {unattributed ? (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-white shadow-glow">
              <Bot className="h-5 w-5" />
            </span>
          ) : (
            <Avatar
              initials={initials(card.repName || "?")}
              seed={card.repUserId ?? card.repName}
              size={compact ? "sm" : "md"}
            />
          )}
          <div className="min-w-0">
            <p className="truncate font-semibold leading-tight">
              {card.repName || (isAi ? "AI agent" : "Teammate")}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {card.mode && (
                <Badge tone={isAi ? "primary" : "accent"} className="px-1.5 py-0 text-[11px]">
                  {isAi ? (
                    <span className="inline-flex items-center gap-1">
                      <Bot className="h-3 w-3" /> AI
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" /> Manual
                    </span>
                  )}
                </Badge>
              )}
              {card.campaignName && (
                <Badge tone="outline" className="max-w-36 px-1.5 py-0 text-[11px]">
                  <Flag className="h-3 w-3 shrink-0" />
                  <span className="truncate">{card.campaignName}</span>
                </Badge>
              )}
            </p>
          </div>
        </div>
        <StatusPill state={card.state} pulse={isCall && !card.stale} />
      </div>

      {/* What / with whom */}
      <div
        className={cn(
          "mt-3 flex items-center justify-between gap-2 rounded-xl bg-muted/60",
          compact ? "px-2.5 py-2" : "p-3",
        )}
      >
        <span className="min-w-0 text-sm">
          {card.leadId ? (
            <LeadOpenLink
              leadId={card.leadId}
              className="block max-w-full truncate font-medium"
            >
              {card.leadName || "Open lead"}
            </LeadOpenLink>
          ) : card.leadName ? (
            <span className="block truncate font-medium">{card.leadName}</span>
          ) : card.kind === "rep" && card.aiActiveCount > 0 ? (
            <span className="text-muted-foreground">
              {card.aiActiveCount} AI line{card.aiActiveCount === 1 ? "" : "s"} in flight
            </span>
          ) : (
            <span className="text-muted-foreground">Not on a call</span>
          )}
          {card.city && (
            <span className="block truncate text-xs text-muted-foreground">{card.city}</span>
          )}
        </span>
        {/* State-duration timer — ticking, from when this STATE began. */}
        <span className="shrink-0 font-mono text-sm font-bold tabular">
          {formatDuration(dur)}
        </span>
      </div>

      {/* Trust + pace */}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="tabular">{card.callsToday} calls today</span>
        {card.lastEventAt != null && (
          <span className="inline-flex items-center gap-1.5">
            {card.stale && (
              <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warning">
                Stale
              </span>
            )}
            <span className={cn("tabular", card.stale && "text-warning")}>
              {ago(card.lastEventAt, now)}
            </span>
          </span>
        )}
      </div>

      {/* Actions */}
      {isCall && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={Boolean(listenReason) || listenBusy}
            title={listenReason ?? (listening ? "Stop listening" : "Listen live, muted")}
            onClick={(e) => {
              e.stopPropagation();
              onToggleListen(card);
            }}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors",
              listening
                ? "border-success/40 bg-success/10 text-success"
                : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {listenBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Headphones className="h-3.5 w-3.5" />
            )}
            {listening ? "Listening — stop" : "Listen"}
          </button>
          {isAi && card.conversationId && canIntervene && (
            <button
              type="button"
              disabled={endBusy}
              title="End this AI call now"
              onClick={(e) => {
                e.stopPropagation();
                if (card.conversationId) onEndAi(card.conversationId);
              }}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-danger/30 px-3 py-1.5 text-xs font-semibold text-danger transition-colors hover:bg-danger/10 disabled:opacity-50"
            >
              {endBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <PhoneOff className="h-3.5 w-3.5" />
              )}
              End
            </button>
          )}
        </div>
      )}
    </Card>
  );
}
