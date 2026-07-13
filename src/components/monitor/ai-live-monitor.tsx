"use client";

import {
  Bot,
  CalendarCheck,
  CheckCircle2,
  Frown,
  Headphones,
  Meh,
  PhoneCall,
  PhoneOff,
  Radio,
  Smile,
  Sparkles,
  Zap,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SpotlightCard } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CONNECTED_OUTCOMES } from "@/lib/call-analytics";
import type { AILiveState, CallOutcome } from "@/lib/types";
import { liveStateConfig, outcomeConfig } from "@/lib/status";
import { cn, formatDuration } from "@/lib/utils";
import { CallDashboard } from "./call-dashboard";

type Sentiment = "positive" | "neutral" | "negative";

type AICall = {
  conversationId: string;
  callSid: string | null;
  leadName: string;
  phone: string;
  city: string;
  state: AILiveState;
  sentiment: Sentiment;
  startedAt: number;
  /** Their phone started ringing. */
  ringingAt?: number;
  /** They picked up — the talk timer counts from here, never from startedAt. */
  connectedAt?: number;
  endedAt?: number;
  durationSec?: number;
  summary?: string;
  outcome?: CallOutcome;
  recordingAvailable?: boolean;
};

/** How long a call that just ended stays on the board in its terminal state. */
const FLASH_MS = 15_000;

/**
 * A call the monitor is holding on screen for a moment after it ended.
 *
 * Without this a no-answer is invisible: the card simply vanishes between polls
 * and reappears in the "Recent" list, so the one state we most need to SEE — the
 * homeowner didn't pick up — is the one state that never renders. Holding the card
 * briefly, in its own distinct terminal styling, makes the transition observable
 * (and is what makes the 10-call verification something you can actually watch).
 */
type Flash = { call: AICall; until: number };

const sentimentMeta: Record<Sentiment, { icon: typeof Smile; tone: string; label: string }> = {
  positive: { icon: Smile, tone: "text-success", label: "Positive" },
  neutral: { icon: Meh, tone: "text-muted-foreground", label: "Neutral" },
  negative: { icon: Frown, tone: "text-danger", label: "Negative" },
};

const statTones = {
  primary: "bg-primary-soft text-primary",
  success: "bg-success/12 text-success",
  accent: "bg-accent-soft text-accent",
  warning: "bg-warning/15 text-warning",
} as const;

function StatCard({
  icon: Icon,
  label,
  value,
  tone,
  pulse,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone: keyof typeof statTones;
  pulse?: boolean;
}) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", statTones[tone])}>
        <Icon className="h-5 w-5" />
        {pulse && (
          <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-success" />
          </span>
        )}
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tabular">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}

export function AiLiveMonitor({
  configured,
  initialCall = null,
  canListen = false,
  canIntervene = false,
}: {
  configured: boolean;
  initialCall?: string | null;
  canListen?: boolean;
  canIntervene?: boolean;
}) {
  const [active, setActive] = useState<AICall[]>([]);
  const [recent, setRecent] = useState<AICall[]>([]);
  const [flash, setFlash] = useState<Flash[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(initialCall);

  // Which calls were live as of the previous poll — the basis for spotting the
  // moment one of them drops off, which is exactly when a no-answer happens.
  const wasLive = useRef<Set<string>>(new Set());

  const load = useCallback(() => {
    fetch("/api/elevenlabs/conversations", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const nextActive: AICall[] = j.active ?? [];
        const nextRecent: AICall[] = j.recent ?? [];
        const liveNow = new Set(nextActive.map((c) => c.conversationId));

        // Anything that was live last poll and is now terminal just ENDED. Hold it
        // on the board so its final state is actually seen rather than blinking out.
        const justEnded = nextRecent.filter(
          (c) => wasLive.current.has(c.conversationId) && !liveNow.has(c.conversationId),
        );
        if (justEnded.length > 0) {
          const until = Date.now() + FLASH_MS;
          setFlash((prev) => {
            const held = new Map(prev.map((f) => [f.call.conversationId, f]));
            for (const call of justEnded) {
              held.set(call.conversationId, { call, until });
            }
            return [...held.values()];
          });
        }

        wasLive.current = liveNow;
        setActive(nextActive);
        setRecent(nextRecent);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // 2s, down from 4s. The feed is now a plain DB read — Twilio has already
    // pushed the truth into the row by the time we ask — so polling harder is
    // cheap, and halves the worst-case lag between a phone ringing and the
    // monitor saying so.
    const poll = setInterval(load, 2000);
    const tick = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setFlash((prev) => {
        const kept = prev.filter((f) => f.until > t);
        return kept.length === prev.length ? prev : kept;
      });
    }, 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  async function intervene(conversationId: string, action: "takeover" | "end") {
    setBusy(conversationId + action);
    setError("");
    try {
      const res = await fetch("/api/elevenlabs/intervene", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Intervention failed.");
      else load();
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  if (!configured) {
    return (
      <Card className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-solar text-white shadow-glow">
          <Bot className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold">AI voice agent not connected</p>
          <p className="text-sm text-muted-foreground">
            Connect ElevenLabs to watch live AI calls here and take them over in
            real time.
          </p>
        </div>
        <Link
          href="/ai-agent"
          className={buttonVariants({ size: "sm", variant: "outline", className: "gap-2" })}
        >
          <Sparkles className="h-4 w-4" />
          Connect agent
        </Link>
      </Card>
    );
  }

  const connectedCount = recent.filter((c) => c.outcome && CONNECTED_OUTCOMES.has(c.outcome)).length;
  const kpis = {
    // "Live" counts calls actually on the phone — never the just-ended cards still
    // fading off the board.
    live: active.length,
    completed: recent.length,
    booked: recent.filter((c) => c.outcome === "appointment_booked").length,
    connectRate: recent.length ? Math.round((connectedCount / recent.length) * 100) : 0,
  };

  // The board = what's on the phone now, plus what just came off it. Anything the
  // feed reports as live wins over a stale flash card of the same call.
  const liveIds = new Set(active.map((c) => c.conversationId));
  const board: AICall[] = [
    ...active,
    ...flash
      .filter((f) => !liveIds.has(f.call.conversationId))
      .map((f) => f.call),
  ];

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Radio} label="Live now" value={kpis.live} tone="primary" pulse={kpis.live > 0} />
        <StatCard icon={CheckCircle2} label="Recently completed" value={kpis.completed} tone="success" />
        <StatCard icon={CalendarCheck} label="Appointments" value={kpis.booked} tone="accent" />
        <StatCard icon={Zap} label="Connect rate" value={`${kpis.connectRate}%`} tone="warning" />
      </div>

      {error && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          {error}
        </p>
      )}

      {/* Live calls */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold tracking-tight">Live AI calls</h3>
          <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-success">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            {active.length} live
          </span>
        </div>

        {board.length === 0 ? (
          <Card className="flex flex-col items-center gap-1 p-8 text-center">
            <Bot className="mb-1 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No live AI calls right now</p>
            <p className="text-sm text-muted-foreground">
              Start an AI session from the{" "}
              <Link href="/dialer" className="font-semibold text-primary hover:underline">
                Power Dialer
              </Link>{" "}
              and watch it here in real time.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {board.map((c, i) => {
              const s = sentimentMeta[c.sentiment];
              const Sentiment = s.icon;
              const meta = liveStateConfig[c.state];
              const ended = c.state === "completed" || c.state === "failed";

              // The talk timer runs from the moment they PICKED UP. It used to
              // count from startedAt, so a call that was merely ringing already
              // showed a growing "on call" duration — the clock itself was lying.
              const dur = meta.timer && c.connectedAt
                ? Math.min(Math.max(0, Math.floor((now - c.connectedAt) / 1000)), 60 * 60)
                : null;

              // What the card says it's doing, in the homeowner's terms.
              const statusLine = ended
                ? (c.outcome ? outcomeConfig[c.outcome].label : meta.label)
                : c.state === "in_progress"
                  ? "AI on call"
                  : c.state === "ringing"
                    ? "Their phone is ringing"
                    : "Placing the call…";

              return (
                <SpotlightCard
                  key={c.conversationId}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.4 }}
                  onClick={() => setOpenId(c.conversationId)}
                  className={cn(
                    "cursor-pointer overflow-hidden p-5 ring-1 transition-colors",
                    c.state === "in_progress" && "ring-success/30",
                    c.state === "ringing" && "ring-warning/40",
                    c.state === "initiated" && "ring-border",
                    ended && "opacity-70 ring-border",
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <span
                        className={cn(
                          "relative flex h-10 w-10 items-center justify-center rounded-xl text-white",
                          ended ? "bg-muted-foreground/40" : "bg-solar shadow-glow",
                        )}
                      >
                        <Bot className="h-5 w-5" />
                        {/* The presence dot means "a human is on this line". It was
                            previously shown on EVERY active card, including ones
                            that were still ringing. */}
                        {meta.live && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-70" />
                            <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-card bg-success" />
                          </span>
                        )}
                        {c.state === "ringing" && (
                          <span className="absolute -bottom-0.5 -right-0.5 flex h-3.5 w-3.5">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warning opacity-70" />
                            <span className="relative inline-flex h-3.5 w-3.5 rounded-full border-2 border-card bg-warning" />
                          </span>
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold leading-tight">{c.leadName}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.city}</p>
                      </div>
                    </div>
                    <Badge
                      tone={ended && c.outcome ? outcomeConfig[c.outcome].tone : meta.tone}
                      dot={!ended}
                    >
                      {ended && c.outcome ? outcomeConfig[c.outcome].label : meta.label}
                    </Badge>
                  </div>

                  <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/60 p-3">
                    <span
                      className={cn(
                        "flex items-center gap-1.5 text-xs font-medium",
                        c.state === "in_progress" ? s.tone : "text-muted-foreground",
                      )}
                    >
                      {c.state === "in_progress" ? (
                        <Sentiment className="h-4 w-4" />
                      ) : ended ? (
                        <PhoneOff className="h-4 w-4" />
                      ) : (
                        <PhoneCall
                          className={cn(
                            "h-4 w-4",
                            c.state === "ringing" && "animate-pulse text-warning",
                          )}
                        />
                      )}
                      {statusLine}
                    </span>
                    {/* No timer before pickup — there is nothing yet to time. */}
                    {dur != null ? (
                      <span className="font-mono text-sm font-bold tabular">
                        {formatDuration(dur)}
                      </span>
                    ) : ended && c.durationSec != null ? (
                      <span className="font-mono text-sm font-bold tabular text-muted-foreground">
                        {formatDuration(c.durationSec)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>

                  <div className="mt-4 flex gap-2">
                    <Button
                      size="sm"
                      variant="primary"
                      className="flex-1 gap-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(c.conversationId);
                      }}
                    >
                      <Headphones className="h-3.5 w-3.5" />
                      {ended
                        ? "Open"
                        : canIntervene
                          ? "Manage & take over"
                          : "Open & listen"}
                    </Button>
                    {canIntervene && !ended && (
                      <Button
                        size="sm"
                        variant="danger"
                        className="gap-1.5"
                        disabled={busy === c.conversationId + "end"}
                        onClick={(e) => {
                          e.stopPropagation();
                          intervene(c.conversationId, "end");
                        }}
                      >
                        <PhoneOff className="h-3.5 w-3.5" />
                        End
                      </Button>
                    )}
                  </div>
                </SpotlightCard>
              );
            })}
          </div>
        )}
      </section>

      {/* Recent calls */}
      {recent.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold tracking-tight">Recent AI calls</h3>
          <Card className="overflow-hidden">
            <div className="divide-y divide-border">
              {recent.map((c) => {
                const cfg = c.outcome ? outcomeConfig[c.outcome] : null;
                return (
                  <button
                    key={c.conversationId}
                    type="button"
                    onClick={() => setOpenId(c.conversationId)}
                    className="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                      <Sparkles className="h-4 w-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{c.leadName}</p>
                        {cfg && <Badge tone={cfg.tone}>{cfg.label}</Badge>}
                        {c.durationSec != null && (
                          <span className="text-xs text-muted-foreground tabular">
                            {formatDuration(c.durationSec)}
                          </span>
                        )}
                      </div>
                      {c.summary && (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.summary}</p>
                      )}
                    </div>
                    <span className="mt-0.5 flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
                      <Headphones className="h-3.5 w-3.5" />
                      Open
                    </span>
                  </button>
                );
              })}
            </div>
          </Card>
        </section>
      )}

      {openId && (
        <CallDashboard
          key={openId}
          conversationId={openId}
          canListen={canListen}
          canIntervene={canIntervene}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
