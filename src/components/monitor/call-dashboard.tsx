"use client";

import type { Call, Device } from "@twilio/voice-sdk";
import { motion } from "framer-motion";
import {
  Bot,
  CalendarCheck,
  ClipboardList,
  Frown,
  Headphones,
  Loader2,
  Meh,
  MessageSquare,
  Mic,
  MicOff,
  PhoneForwarded,
  PhoneOff,
  Play,
  Radio,
  Settings2,
  Smile,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { OutcomeGrid } from "@/components/dialer/outcome-grid";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { createPcmPlayer, type PcmPlayer } from "@/lib/pcm-player";
import { outcomeConfig } from "@/lib/status";
import type { CallOutcome } from "@/lib/types";
import { cn, formatDuration, formatPhone } from "@/lib/utils";

type AICallState = "initiated" | "in_progress" | "completed" | "failed";
type Sentiment = "positive" | "neutral" | "negative";

export type CallDetail = {
  conversationId: string;
  leadId: string | null;
  leadName: string;
  phone: string;
  city: string;
  state: AICallState;
  sentiment: Sentiment;
  outcome: CallOutcome | null;
  summary: string;
  durationSec: number | null;
  startedAt: number | null;
  recordingAvailable: boolean;
  transcript: { role: string; message: string; secs: number | null }[];
  appointment: { when: string; notes: string } | null;
  transferNumber: string;
  configured: boolean;
  liveAudioAvailable: boolean;
};

const sentimentMeta: Record<Sentiment, { icon: typeof Smile; tone: string; label: string }> = {
  positive: { icon: Smile, tone: "text-success", label: "Positive" },
  neutral: { icon: Meh, tone: "text-muted-foreground", label: "Neutral" },
  negative: { icon: Frown, tone: "text-danger", label: "Negative" },
};

const stateMeta: Record<AICallState, { label: string; tone: "primary" | "success" | "danger" | "neutral" }> = {
  initiated: { label: "Dialing", tone: "primary" },
  in_progress: { label: "On call", tone: "primary" },
  completed: { label: "Completed", tone: "success" },
  failed: { label: "Didn't connect", tone: "danger" },
};

/**
 * Per-call mini dashboard + full breakdown — live transcript, AI summary, the
 * booked appointment, the recording, take over / end, and a disposition the
 * supervisor can override. Powers both the Live Monitor and the Reports drill-in.
 */
export function CallDashboard({
  conversationId,
  canListen = false,
  canIntervene = false,
  onClose,
  onChanged,
}: {
  conversationId: string;
  canListen?: boolean;
  /** Take over / transfer / end + override disposition (supervisors only). */
  canIntervene?: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [showDispo, setShowDispo] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [takeover, setTakeover] = useState<"idle" | "joining" | "live">("idle");
  const [takeMuted, setTakeMuted] = useState(false);
  const [listen, setListen] = useState(false);
  const spokenRef = useRef(0);
  const [audioOn, setAudioOn] = useState(false);
  const [audioErr, setAudioErr] = useState("");
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<Device | null>(null);
  const taCallRef = useRef<Call | null>(null);
  const listenCallRef = useRef<Call | null>(null);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/elevenlabs/conversation/${encodeURIComponent(conversationId)}`,
        { cache: "no-store" },
      );
      const json = await res.json().catch(() => null);
      if (res.ok && json) {
        setDetail(json as CallDetail);
        return json as CallDetail;
      }
    } catch {
      /* keep last good detail */
    }
    return null;
  }, [conversationId]);

  // Poll: fast while live, slow once terminal (to catch the late recording).
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function tick() {
      const d = await fetchDetail();
      setLoading(false);
      if (stopped) return;
      const terminal = d?.state === "completed" || d?.state === "failed";
      timer = setTimeout(tick, terminal ? 10000 : 2000);
    }
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [fetchDetail]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep the transcript scrolled to the newest turn.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail?.transcript.length]);

  // Listen in: read new transcript turns aloud as they stream (in-browser).
  useEffect(() => {
    if (!listen || typeof window === "undefined" || !window.speechSynthesis) return;
    const turns = detail?.transcript ?? [];
    for (let i = spokenRef.current; i < turns.length; i++) {
      const msg = turns[i]?.message;
      if (!msg) continue;
      const u = new SpeechSynthesisUtterance(msg);
      u.rate = 1;
      u.pitch = turns[i].role === "agent" ? 0.9 : 1.15;
      window.speechSynthesis.speak(u);
    }
    spokenRef.current = turns.length;
  }, [listen, detail?.transcript]);

  // Stop reading aloud once the call is over, and always on unmount.
  useEffect(() => {
    if (detail && detail.state !== "in_progress" && detail.state !== "initiated") {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
    }
  }, [detail?.state, detail]);

  useEffect(
    () => () => {
      try {
        window.speechSynthesis?.cancel();
      } catch {
        /* noop */
      }
    },
    [],
  );

  function toggleListen() {
    setListen((on) => {
      const next = !on;
      if (next) spokenRef.current = detail?.transcript.length ?? 0;
      else
        try {
          window.speechSynthesis?.cancel();
        } catch {
          /* noop */
        }
      return next;
    });
  }

  // ── Live audio ───────────────────────────────────────────────────────────────
  // Two paths: a Twilio conference join (bridge mode — muted Voice SDK leg, no
  // relay, identical to human calls) or the media-stream relay (PCM → Web Audio).
  const closeAudio = useCallback(() => {
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
    try {
      listenCallRef.current?.disconnect();
    } catch {
      /* noop */
    }
    listenCallRef.current = null;
  }, []);

  function stopAudio() {
    closeAudio();
    setAudioOn(false);
    fetch("/api/twilio/listen", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId, action: "stop" }),
    }).catch(() => {});
  }

  async function startAudio() {
    setAudioErr("");
    setBusy("audio");
    try {
      const res = await fetch("/api/twilio/listen", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setAudioErr(j.error ?? "Could not start live audio.");
        return;
      }

      // Conference mode: join the room muted via the Voice SDK (no relay).
      if (j.room && j.token) {
        const device = await ensureDevice();
        const call = await device.connect({
          params: { Conference: j.room, Monitor: "true", Token: j.token },
        });
        listenCallRef.current = call;
        call.on("disconnect", () => {
          listenCallRef.current = null;
          setAudioOn(false);
        });
        call.on("error", () => {
          setAudioErr("Live audio connection error.");
          listenCallRef.current = null;
          setAudioOn(false);
        });
        setAudioOn(true);
        return;
      }

      // Relay mode: stream PCM frames from the standalone relay.
      if (j.listenUrl) {
        const player = createPcmPlayer();
        playerRef.current = player;
        const ws = new WebSocket(j.listenUrl);
        wsRef.current = ws;
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data as string);
            if (m.event === "media" && m.payload) player.play(m.payload);
            else if (m.event === "ended") stopAudio();
          } catch {
            /* ignore malformed frame */
          }
        };
        ws.onerror = () => setAudioErr("Live audio connection error.");
        setAudioOn(true);
        return;
      }

      setAudioErr("Could not start live audio.");
    } catch (e) {
      setAudioErr(e instanceof Error ? e.message : "Network error — allow microphone access to listen in.");
    } finally {
      setBusy(null);
    }
  }

  // Stop live audio when the call ends, and always tear down on unmount.
  useEffect(() => {
    if (detail && detail.state !== "in_progress" && detail.state !== "initiated") {
      if (wsRef.current) {
        closeAudio();
        setAudioOn(false);
      }
    }
  }, [detail?.state, detail, closeAudio]);

  useEffect(() => () => closeAudio(), [closeAudio]);

  const live = detail?.state === "initiated" || detail?.state === "in_progress";
  const dur = detail
    ? live && detail.startedAt
      ? Math.max(0, Math.floor((now - detail.startedAt) / 1000))
      : (detail.durationSec ?? 0)
    : 0;

  async function intervene(action: "takeover" | "end") {
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/elevenlabs/intervene", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Intervention failed.");
      else {
        await fetchDetail();
        onChanged();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  async function disposition(outcome: CallOutcome) {
    setBusy("dispo");
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/elevenlabs/disposition", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, outcome }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Could not save disposition.");
      } else {
        setShowDispo(false);
        if (json.persisted === false && json.note) setNote(json.note);
        await fetchDetail();
        onChanged();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  // ── Take over: hand the live call from the AI to you (in the browser) ────────
  const ensureDevice = useCallback(async (): Promise<Device> => {
    if (deviceRef.current) return deviceRef.current;
    const res = await fetch("/api/twilio/token");
    const data = (await res.json().catch(() => ({}))) as { token?: string };
    if (!data.token)
      throw new Error("Twilio isn't connected — add credentials to take over calls.");
    const { Device } = await import("@twilio/voice-sdk");
    const device = new Device(data.token, { logLevel: "error" });
    await device.register();
    deviceRef.current = device;
    return device;
  }, []);

  function hangUpTakeover() {
    try {
      taCallRef.current?.disconnect();
    } catch {
      /* noop */
    }
    taCallRef.current = null;
    setTakeover("idle");
    setTakeMuted(false);
  }

  async function doTakeover() {
    setBusy("takeover");
    setError("");
    // Stop passive listening first — one Voice SDK call per device.
    if (audioOn) {
      closeAudio();
      setAudioOn(false);
    }
    setTakeover("joining");
    try {
      const device = await ensureDevice();
      const room = `to-${conversationId}-${Date.now().toString(36)}`
        .replace(/[^a-zA-Z0-9_-]/g, "")
        .slice(0, 100);
      // Join the conference first so the homeowner is never left stranded.
      const call = await device.connect({ params: { Conference: room } });
      taCallRef.current = call;
      call.on("disconnect", () => {
        taCallRef.current = null;
        setTakeover("idle");
        setTakeMuted(false);
      });
      call.on("error", () => {
        setError("Call audio error.");
        setTakeover("idle");
      });
      // Move the homeowner off the AI and into the conference with you.
      const res = await fetch("/api/elevenlabs/intervene", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, action: "takeover", room }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "Take over failed.");
        try {
          call.disconnect();
        } catch {
          /* noop */
        }
        setTakeover("idle");
        return;
      }
      setTakeover("live");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not take over the call.");
      setTakeover("idle");
    } finally {
      setBusy(null);
    }
  }

  function toggleTakeMute() {
    setTakeMuted((m) => {
      const next = !m;
      try {
        taCallRef.current?.mute(next);
      } catch {
        /* noop */
      }
      return next;
    });
  }

  async function doTransfer() {
    setBusy("transfer");
    setError("");
    setNote("");
    try {
      const res = await fetch("/api/elevenlabs/intervene", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId, action: "transfer" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setError(json.error ?? "Transfer failed.");
      else {
        setNote(`Transferred to ${formatPhone(json.target ?? "")}.`);
        await fetchDetail();
        onChanged();
      }
    } catch {
      setError("Network error.");
    } finally {
      setBusy(null);
    }
  }

  // Tear down the take-over device when the dashboard closes.
  useEffect(
    () => () => {
      try {
        taCallRef.current?.disconnect();
      } catch {
        /* noop */
      }
      try {
        deviceRef.current?.destroy();
      } catch {
        /* noop */
      }
    },
    [],
  );

  const st = detail ? stateMeta[detail.state] : stateMeta.initiated;
  const sent = sentimentMeta[detail?.sentiment ?? "neutral"];
  const SentIcon = sent.icon;
  const cfg = detail?.outcome ? outcomeConfig[detail.outcome] : null;
  const firstName = (detail?.leadName ?? "").split(" ")[0] || "Homeowner";

  return (
    <Portal>
    <motion.div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-0 bg-background/70 backdrop-blur-xl"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />

      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="glass relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl border border-border/60 shadow-lift sm:max-h-[88vh] sm:rounded-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-solar text-white shadow-glow">
              <Bot className="h-5 w-5" />
              {live && (
                <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card bg-success" />
              )}
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold leading-tight">
                {detail?.leadName || "AI call"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {[detail?.city, detail?.phone].filter(Boolean).join(" · ") ||
                  "Connecting…"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge tone={st.tone} dot={live}>
              {st.label}
            </Badge>
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
        <div className="flex items-center justify-between gap-3 border-b border-border/60 bg-muted/40 px-5 py-2.5">
          <span className={cn("flex items-center gap-1.5 text-xs font-medium", sent.tone)}>
            <SentIcon className="h-4 w-4" />
            {sent.label}
          </span>
          {cfg && <Badge tone={cfg.tone}>{cfg.label}</Badge>}
          <span className="ml-auto flex items-center gap-1.5 font-mono text-sm font-bold tabular">
            {live && (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
            )}
            {formatDuration(dur)}
          </span>
        </div>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-5">
          {detail?.summary && (
            <div className="rounded-xl border border-border/60 bg-surface/60 p-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <ClipboardList className="h-3.5 w-3.5" />
                AI summary
              </p>
              <p className="text-sm leading-relaxed">{detail.summary}</p>
            </div>
          )}

          {detail?.appointment && (
            <div className="rounded-xl border border-success/30 bg-success/5 p-4">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-success">
                <CalendarCheck className="h-3.5 w-3.5" />
                Appointment booked
              </p>
              <p className="text-sm font-semibold">{detail.appointment.when}</p>
              {detail.appointment.notes && (
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {detail.appointment.notes}
                </p>
              )}
            </div>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <MessageSquare className="h-3.5 w-3.5" />
                Transcript
                {live && (
                  <span className="ml-1 inline-flex items-center gap-1 rounded-full bg-success/12 px-1.5 py-0.5 text-[10px] font-bold text-success">
                    <Radio className="h-3 w-3" />
                    LIVE
                  </span>
                )}
              </p>
              {live && (
                <div className="flex items-center gap-1.5">
                  {detail?.liveAudioAvailable && canListen && (
                    <button
                      type="button"
                      onClick={() => (audioOn ? stopAudio() : startAudio())}
                      disabled={busy === "audio"}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                        audioOn
                          ? "border-success/40 bg-success/10 text-success"
                          : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      {busy === "audio" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Headphones className="h-3.5 w-3.5" />
                      )}
                      {audioOn ? "Listening (audio)" : "Listen live"}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={toggleListen}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors",
                      listen
                        ? "border-primary/40 bg-primary-soft text-primary"
                        : "border-border text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    {listen ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    {listen ? "Reading…" : "Read aloud"}
                  </button>
                </div>
              )}
            </div>
            {audioErr && (
              <p className="mb-2 text-xs font-medium text-danger">{audioErr}</p>
            )}

            {loading && !detail ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading conversation…
              </div>
            ) : detail && detail.transcript.length > 0 ? (
              <div className="space-y-2.5">
                {detail.transcript.map((t, i) => {
                  const isAgent = t.role === "agent";
                  return (
                    <div
                      key={i}
                      className={cn("flex", isAgent ? "justify-start" : "justify-end")}
                    >
                      <div
                        className={cn(
                          "max-w-[82%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
                          isAgent
                            ? "rounded-bl-md bg-muted text-foreground"
                            : "rounded-br-md bg-solar text-white",
                        )}
                      >
                        <p
                          className={cn(
                            "mb-0.5 text-[10px] font-bold uppercase tracking-wide",
                            isAgent ? "text-muted-foreground" : "text-white/70",
                          )}
                        >
                          {isAgent ? "AI agent" : firstName}
                        </p>
                        {t.message}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                {live
                  ? "Waiting for the conversation to begin…"
                  : detail?.state === "failed"
                    ? "No conversation — the call didn't connect. Auto-categorized below."
                    : "No transcript available for this call."}
              </div>
            )}
          </div>

          {detail?.recordingAvailable && (
            <div className="rounded-xl border border-border/60 bg-surface/60 p-4">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <Play className="h-3.5 w-3.5" />
                Recording
              </p>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio
                controls
                preload="none"
                src={`/api/elevenlabs/audio/${encodeURIComponent(conversationId)}`}
                className="w-full"
              />
            </div>
          )}
        </div>

        {/* Footer — controls */}
        <div className="space-y-3 border-t border-border/60 p-5">
          {error && <p className="text-xs font-medium text-danger">{error}</p>}
          {note && <p className="text-xs font-medium text-warning">{note}</p>}

          {/* You're live on the call (AI handed off) */}
          {takeover !== "idle" && (
            <div className="rounded-xl border border-success/40 bg-success/5 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-success">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                </span>
                {takeover === "joining"
                  ? "Connecting you to the homeowner…"
                  : "You're on the call — the AI has handed off to you"}
              </p>
              {takeover === "live" && (
                <div className="mt-2.5 flex gap-2">
                  <Button variant="outline" className="flex-1 gap-1.5" onClick={toggleTakeMute}>
                    {takeMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                    {takeMuted ? "Unmute" : "Mute"}
                  </Button>
                  <Button variant="danger" className="flex-1 gap-1.5" onClick={hangUpTakeover}>
                    <PhoneOff className="h-4 w-4" />
                    Hang up
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Live-call controls: take over (AI → you), transfer, or end */}
          {live && canIntervene && takeover === "idle" && (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                className="flex-1 gap-1.5"
                disabled={busy === "takeover"}
                onClick={doTakeover}
              >
                {busy === "takeover" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Headphones className="h-4 w-4" />
                )}
                Take over
              </Button>
              <Button
                variant="outline"
                className="flex-1 gap-1.5"
                disabled={busy === "transfer"}
                onClick={doTransfer}
              >
                {busy === "transfer" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PhoneForwarded className="h-4 w-4" />
                )}
                {detail?.transferNumber
                  ? `Transfer to ${formatPhone(detail.transferNumber)}`
                  : "Transfer"}
              </Button>
              <Button
                variant="danger"
                className="gap-1.5"
                disabled={busy === "end"}
                onClick={() => intervene("end")}
              >
                {busy === "end" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PhoneOff className="h-4 w-4" />
                )}
                End
              </Button>
            </div>
          )}

          {canIntervene &&
            (showDispo ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {detail?.outcome ? "Override disposition" : "Set disposition"}
                  </p>
                  <button
                    type="button"
                    onClick={() => setShowDispo(false)}
                    className="text-xs font-medium text-muted-foreground hover:text-foreground"
                  >
                    Cancel
                  </button>
                </div>
                <OutcomeGrid onSelect={disposition} />
              </div>
            ) : (
              <Button
                variant="subtle"
                className="w-full gap-1.5"
                disabled={busy === "dispo"}
                onClick={() => setShowDispo(true)}
              >
                {busy === "dispo" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Settings2 className="h-4 w-4" />
                )}
                {detail?.outcome ? "Override disposition" : "Set disposition manually"}
              </Button>
            ))}
        </div>
      </motion.div>
    </motion.div>
    </Portal>
  );
}
