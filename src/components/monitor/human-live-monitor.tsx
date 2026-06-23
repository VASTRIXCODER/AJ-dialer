"use client";

import { Headphones, Loader2, Phone, User } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { createPcmPlayer, type PcmPlayer } from "@/lib/pcm-player";
import { cn, formatDuration, formatPhone } from "@/lib/utils";

type HumanCall = {
  id: string;
  leadName: string;
  city: string;
  phone: string;
  state: "ringing" | "connected";
  startedAt: number;
  repName: string;
  canListen: boolean;
};

/**
 * Live presence for human (manual) rep↔customer calls, polled from
 * /api/calls/active (scoped to the supervisor's org). A supervisor with
 * monitor.listen can listen in on a connected call — the rep's call audio is
 * forked to the relay and played here without interrupting the call.
 */
export function HumanLiveMonitor({ canListen = false }: { canListen?: boolean }) {
  const [calls, setCalls] = useState<HumanCall[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [listeningId, setListeningId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);

  const stopListening = useCallback((notifyServer = true) => {
    try {
      wsRef.current?.close();
    } catch {
      /* noop */
    }
    wsRef.current = null;
    try {
      playerRef.current?.close();
    } catch {
      /* noop */
    }
    playerRef.current = null;
    setListeningId((id) => {
      if (id && notifyServer) {
        fetch("/api/twilio/listen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ humanId: id, action: "stop" }),
        }).catch(() => {});
      }
      return null;
    });
  }, []);

  useEffect(() => {
    const load = () =>
      fetch("/api/calls/active", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { active: [] }))
        .then((j) => setCalls(j.active ?? []))
        .catch(() => {});
    load();
    const poll = setInterval(load, 4000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  // Stop audio when the call we're listening to disappears, and on unmount.
  useEffect(() => {
    if (listeningId && !calls.some((c) => c.id === listeningId)) {
      stopListening(false);
    }
  }, [calls, listeningId, stopListening]);
  useEffect(() => () => stopListening(false), [stopListening]);

  async function listen(id: string) {
    setErr("");
    if (listeningId === id) {
      stopListening();
      return;
    }
    if (listeningId) stopListening();
    setBusyId(id);
    try {
      const res = await fetch("/api/twilio/listen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ humanId: id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok || !j.listenUrl) {
        setErr(j.error ?? "Could not start live audio.");
        return;
      }
      const player = createPcmPlayer();
      playerRef.current = player;
      const ws = new WebSocket(j.listenUrl);
      wsRef.current = ws;
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data as string);
          if (m.event === "media" && m.payload) player.play(m.payload);
          else if (m.event === "ended") stopListening(false);
        } catch {
          /* ignore malformed frame */
        }
      };
      ws.onerror = () => setErr("Live audio connection error.");
      setListeningId(id);
    } catch {
      setErr("Network error.");
    } finally {
      setBusyId(null);
    }
  }

  if (calls.length === 0) return null;

  return (
    <section className="space-y-3 border-t border-border pt-6">
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold tracking-tight">Live rep calls</h3>
        <span className="flex items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-success">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          </span>
          {calls.length} live
        </span>
      </div>

      {err && <p className="text-xs font-medium text-danger">{err}</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {calls.map((c) => {
          const dur = Math.min(
            Math.max(0, Math.floor((now - c.startedAt) / 1000)),
            60 * 60,
          );
          const connected = c.state === "connected";
          const isListening = listeningId === c.id;
          return (
            <Card key={c.id} className="overflow-hidden p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <span className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                    <User className="h-5 w-5" />
                    {connected && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-success" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-semibold leading-tight">{c.leadName}</p>
                    <p className="truncate text-xs text-muted-foreground tabular">
                      {c.city || (c.phone ? formatPhone(c.phone) : "Manual call")}
                    </p>
                  </div>
                </div>
                <Badge tone={connected ? "success" : "warning"} dot>
                  {connected ? "On call" : "Ringing"}
                </Badge>
              </div>

              {c.repName && (
                <p className="mt-3 truncate text-xs text-muted-foreground">
                  Rep: <span className="font-medium text-foreground">{c.repName}</span>
                </p>
              )}

              <div className="mt-3 flex items-center justify-between rounded-xl bg-muted/60 p-3">
                <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Phone className="h-4 w-4" />
                  Manual call
                </span>
                <span className="font-mono text-sm font-bold tabular">
                  {formatDuration(dur)}
                </span>
              </div>

              {canListen && connected && (
                <button
                  type="button"
                  onClick={() => listen(c.id)}
                  disabled={busyId === c.id || (!c.canListen && !isListening)}
                  className={cn(
                    "mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors",
                    isListening
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground disabled:opacity-50",
                  )}
                >
                  {busyId === c.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Headphones className="h-3.5 w-3.5" />
                  )}
                  {isListening
                    ? "Listening — stop"
                    : c.canListen
                      ? "Listen live"
                      : "Connecting audio…"}
                </button>
              )}
            </Card>
          );
        })}
      </div>
    </section>
  );
}
