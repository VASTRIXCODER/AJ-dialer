"use client";

import {
  Bot,
  ExternalLink,
  Flag,
  Headphones,
  Loader2,
  PhoneForwarded,
  PhoneOff,
  SquareArrowOutUpRight,
  User,
  X,
} from "lucide-react";
import { useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { useLead360 } from "@/components/leads/lead-360/lead-360-provider";
import { CallDashboard } from "@/components/monitor/call-dashboard";
import {
  type FloorCapabilities,
  type FloorCardModel,
  listenDisabledReason,
} from "@/components/monitor/floor-card";
import { LiveTranscriptPane } from "@/components/monitor/live-transcript-pane";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { StatusPill } from "@/components/ui/status-pill";
import { cn, formatDuration, formatPhone } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// FloorDetailPanel — the drawer a floor card opens: full call context, the
// live transcript (AI calls — the relay pane), intervene controls, and the
// jumps (Lead 360, the full call console). Human calls get an honest note
// instead of a transcript: manual calls aren't transcribed live, and saying so
// beats an empty pane that looks broken.
// ─────────────────────────────────────────────────────────────────────────────

export function FloorDetailPanel({
  card,
  orgId,
  now,
  canListen,
  canIntervene,
  capabilities,
  listening,
  listenBusy,
  onToggleListen,
  onClose,
  onChanged,
}: {
  card: FloorCardModel | null;
  orgId: string | null;
  now: number;
  canListen: boolean;
  canIntervene: boolean;
  capabilities: FloorCapabilities;
  listening: boolean;
  listenBusy: boolean;
  onToggleListen: (card: FloorCardModel) => void;
  onClose: () => void;
  onChanged: () => void;
}) {
  const vocab = useVocabulary();
  const { open: openLead } = useLead360();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [console_, setConsole] = useState(false);

  if (!card) return null;

  const isAiCall = card.kind === "call" && card.mode === "ai" && card.conversationId;
  const listenReason = listenDisabledReason(card, canListen, capabilities);
  const dur = Math.max(0, Math.floor((now - card.stateSince) / 1000));
  const firstName = (card.leadName ?? "").split(" ")[0] || vocab.LeadNoun;

  async function intervene(action: "end" | "transfer") {
    if (!card?.conversationId) return;
    setBusy(action);
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/elevenlabs/intervene", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: card.conversationId, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Intervention failed.");
      } else {
        if (action === "transfer" && json.target)
          setNote(`Transferred to ${formatPhone(String(json.target))}.`);
        onChanged();
        if (action === "end") onClose();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Drawer open onClose={onClose} label={card.leadName || card.repName || "Live call"} width={560}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold leading-tight">
            {card.leadName || (card.kind === "rep" ? card.repName : "Live call")}
          </p>
          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            {card.repName && (
              <span className="truncate">
                {card.mode === "ai" ? "Launched by" : "Rep"}:{" "}
                <span className="font-medium text-foreground">{card.repName}</span>
              </span>
            )}
            {card.mode && (
              <Badge tone={card.mode === "ai" ? "primary" : "accent"} className="px-1.5 py-0 text-[11px]">
                {card.mode === "ai" ? (
                  <span className="inline-flex items-center gap-1"><Bot className="h-3 w-3" /> AI</span>
                ) : (
                  <span className="inline-flex items-center gap-1"><User className="h-3 w-3" /> Manual</span>
                )}
              </Badge>
            )}
            {card.campaignName && (
              <Badge tone="outline" className="px-1.5 py-0 text-[11px]">
                <Flag className="h-3 w-3" /> {card.campaignName}
              </Badge>
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill state={card.state} size="md" />
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
      <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/40 px-5 py-2.5 text-xs">
        <span className="text-muted-foreground">
          {card.city || " "}
        </span>
        <span className="font-mono text-sm font-bold tabular">{formatDuration(dur)}</span>
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {error && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs font-medium text-danger">{error}</p>
        )}
        {note && <p className="text-xs font-medium text-warning">{note}</p>}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {card.kind === "call" && (
            <Button
              variant={listening ? "outline" : "primary"}
              size="sm"
              className={cn("gap-1.5", listening && "border-success/40 text-success")}
              disabled={Boolean(listenReason) || listenBusy}
              title={listenReason ?? undefined}
              onClick={() => onToggleListen(card)}
            >
              {listenBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Headphones className="h-3.5 w-3.5" />
              )}
              {listening ? "Listening — stop" : "Listen live"}
            </Button>
          )}
          {isAiCall && canIntervene && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={busy === "transfer"}
                onClick={() => intervene("transfer")}
              >
                {busy === "transfer" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PhoneForwarded className="h-3.5 w-3.5" />
                )}
                Transfer
              </Button>
              <Button
                variant="danger"
                size="sm"
                className="gap-1.5"
                disabled={busy === "end"}
                onClick={() => intervene("end")}
              >
                {busy === "end" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <PhoneOff className="h-3.5 w-3.5" />
                )}
                End call
              </Button>
              <Button
                variant="subtle"
                size="sm"
                className="gap-1.5"
                title="Take over, override the disposition, and hear the recording — the full per-call console"
                onClick={() => setConsole(true)}
              >
                <SquareArrowOutUpRight className="h-3.5 w-3.5" />
                Full console
              </Button>
            </>
          )}
          {card.leadId && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                if (card.leadId) {
                  onClose(); // sibling portals share z-index — clear the drawer first
                  openLead(card.leadId);
                }
              }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open {vocab.leadNoun} 360
            </Button>
          )}
        </div>

        {/* Live transcript */}
        {isAiCall && card.conversationId ? (
          <LiveTranscriptPane
            orgId={orgId}
            conversationId={card.conversationId}
            live
            contactLabel={firstName}
            className="min-h-64 flex-1"
          />
        ) : card.kind === "call" ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
            Manual calls aren&apos;t transcribed live. Listen in for audio; the
            recording and transcript land in Reports after the call.
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
            No live call right now — this seat is {String(card.state).replace("_", " ")}.
          </div>
        )}
      </div>

      {/* The existing per-call console (take over / dispo / recording). */}
      {console_ && card.conversationId && (
        <CallDashboard
          conversationId={card.conversationId}
          canListen={canListen}
          canIntervene={canIntervene}
          onClose={() => setConsole(false)}
          onChanged={onChanged}
        />
      )}
    </Drawer>
  );
}
