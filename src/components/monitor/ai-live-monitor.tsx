"use client";

import { motion } from "framer-motion";
import {
  Bot,
  PhoneForwarded,
  PhoneOff,
  Play,
  Sparkles,
  Frown,
  Meh,
  Smile,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SpotlightCard } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { CallOutcome } from "@/lib/types";
import { outcomeConfig } from "@/lib/status";
import { cn, formatDuration } from "@/lib/utils";

type AICall = {
  conversationId: string;
  callSid: string | null;
  leadName: string;
  phone: string;
  city: string;
  state: "initiated" | "in_progress" | "completed" | "failed";
  sentiment: "positive" | "neutral" | "negative";
  startedAt: number;
  endedAt?: number;
  durationSec?: number;
  summary?: string;
  outcome?: CallOutcome;
  recordingAvailable?: boolean;
};

const sentimentMeta = {
  positive: { icon: Smile, tone: "text-success" },
  neutral: { icon: Meh, tone: "text-muted-foreground" },
  negative: { icon: Frown, tone: "text-danger" },
} as const;

export function AiLiveMonitor({ configured }: { configured: boolean }) {
  const [active, setActive] = useState<AICall[]>([]);
  const [recent, setRecent] = useState<AICall[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    fetch("/api/elevenlabs/conversations")
      .then((r) => r.json())
      .then((j) => {
        setActive(j.active ?? []);
        setRecent(j.recent ?? []);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
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

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold tracking-tight">AI agent calls</h3>
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-success">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          {active.length} live
        </span>
      </div>

      {error && <p className="text-xs font-medium text-danger">{error}</p>}

      {active.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No active AI calls. Launch one from the{" "}
          <Link href="/dialer" className="font-semibold text-primary hover:underline">
            Power Dialer
          </Link>
          .
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {active.map((c, i) => {
            const s = sentimentMeta[c.sentiment];
            const Sentiment = s.icon;
            const dur = Math.max(0, Math.floor((now - c.startedAt) / 1000));
            return (
              <SpotlightCard
                key={c.conversationId}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.4 }}
                className="overflow-hidden p-5 ring-1 ring-primary/20"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-solar text-white shadow-glow">
                      <Bot className="h-5 w-5" />
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-success" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold leading-tight">{c.leadName}</p>
                      <p className="truncate text-xs text-muted-foreground">{c.city}</p>
                    </div>
                  </div>
                  <Badge tone="primary" dot className="capitalize">
                    {c.state.replace("_", " ")}
                  </Badge>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/60 p-3">
                  <span className={cn("flex items-center gap-1.5 text-xs font-medium", s.tone)}>
                    <Sentiment className="h-4 w-4" />
                    AI on call
                  </span>
                  <span className="font-mono text-sm font-bold tabular">
                    {formatDuration(dur)}
                  </span>
                </div>

                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 gap-1.5"
                    disabled={busy === c.conversationId + "takeover"}
                    onClick={() => intervene(c.conversationId, "takeover")}
                  >
                    <PhoneForwarded className="h-3.5 w-3.5" />
                    Take over
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    className="flex-1 gap-1.5"
                    disabled={busy === c.conversationId + "end"}
                    onClick={() => intervene(c.conversationId, "end")}
                  >
                    <PhoneOff className="h-3.5 w-3.5" />
                    End
                  </Button>
                </div>
              </SpotlightCard>
            );
          })}
        </div>
      )}

      {recent.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-border p-4">
            <h4 className="text-sm font-semibold">Recent AI calls</h4>
          </div>
          <div className="divide-y divide-border">
            {recent.map((c) => {
              const cfg = c.outcome ? outcomeConfig[c.outcome] : null;
              return (
                <div key={c.conversationId} className="flex items-start gap-3 p-4">
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
                      <p className="mt-1 text-xs text-muted-foreground">{c.summary}</p>
                    )}
                  </div>
                  {c.recordingAvailable && (
                    <a
                      href={`/api/elevenlabs/audio/${c.conversationId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonVariants({
                        size: "sm",
                        variant: "ghost",
                        className: "shrink-0 gap-1.5",
                      })}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Listen
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
