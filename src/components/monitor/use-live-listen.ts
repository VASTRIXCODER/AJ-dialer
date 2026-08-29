"use client";

import type { Call, Device } from "@twilio/voice-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPcmPlayer, type PcmPlayer } from "@/lib/pcm-player";

// ─────────────────────────────────────────────────────────────────────────────
// useLiveListen — the floor's handle on the EXISTING listen-in flow. This hook
// invents no audio path: it invokes /api/twilio/listen exactly the way
// HumanLiveMonitor and CallDashboard do, then either
//   • joins the returned Twilio conference MUTED via the Voice SDK
//     (params { Conference, Monitor: "true", Token }) — human calls and AI
//     bridge mode, or
//   • plays the media-stream relay's PCM frames (listenUrl → WebSocket →
//     createPcmPlayer) — AI direct mode.
// One Voice Device per hook instance (lazily minted, cached, destroyed on
// unmount); starting a new listen stops the previous one — one ear at a time.
// ─────────────────────────────────────────────────────────────────────────────

export type ListenTarget =
  | { kind: "human"; humanId: string }
  | { kind: "ai"; conversationId: string };

export function listenKey(t: ListenTarget): string {
  return t.kind === "human" ? `human:${t.humanId}` : `ai:${t.conversationId}`;
}

function targetBody(t: ListenTarget, action?: "stop") {
  return {
    ...(t.kind === "human"
      ? { humanId: t.humanId }
      : { conversationId: t.conversationId }),
    ...(action ? { action } : {}),
  };
}

export function useLiveListen() {
  const [listeningKey, setListeningKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const targetRef = useRef<ListenTarget | null>(null);

  const ensureDevice = useCallback(async (): Promise<Device> => {
    if (deviceRef.current) return deviceRef.current;
    const res = await fetch("/api/twilio/token");
    const data = (await res.json().catch(() => ({}))) as { token?: string };
    if (!data.token)
      throw new Error("Twilio isn't connected — add credentials to listen in.");
    const { Device } = await import("@twilio/voice-sdk");
    const device = new Device(data.token, { logLevel: "error" });
    await device.register();
    deviceRef.current = device;
    return device;
  }, []);

  const teardown = useCallback(() => {
    try {
      callRef.current?.disconnect();
    } catch {
      /* noop */
    }
    callRef.current = null;
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
  }, []);

  const stop = useCallback(
    (notifyServer = true) => {
      const target = targetRef.current;
      teardown();
      targetRef.current = null;
      setListeningKey(null);
      if (target && notifyServer) {
        fetch("/api/twilio/listen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(targetBody(target, "stop")),
        }).catch(() => {});
      }
    },
    [teardown],
  );

  const start = useCallback(
    async (target: ListenTarget) => {
      const key = listenKey(target);
      setError("");
      if (listeningKey === key) {
        stop();
        return;
      }
      if (listeningKey) stop();
      setBusyKey(key);
      try {
        const res = await fetch("/api/twilio/listen", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(targetBody(target)),
        });
        const j = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          room?: string;
          token?: string;
          listenUrl?: string;
          error?: string;
        };
        if (!res.ok || !j.ok) {
          setError(j.error ?? "Could not start live audio.");
          return;
        }

        // Conference mode — join the room muted (hear both sides, stay silent).
        if (j.room && j.token) {
          const device = await ensureDevice();
          const call = await device.connect({
            params: { Conference: j.room, Monitor: "true", Token: j.token },
          });
          callRef.current = call;
          call.on("disconnect", () => {
            callRef.current = null;
            setListeningKey((cur) => (cur === key ? null : cur));
          });
          call.on("error", () => {
            setError("Live audio connection error.");
            callRef.current = null;
            setListeningKey((cur) => (cur === key ? null : cur));
          });
          targetRef.current = target;
          setListeningKey(key);
          return;
        }

        // Relay mode — stream PCM frames from the standalone relay.
        if (j.listenUrl) {
          const player = createPcmPlayer();
          playerRef.current = player;
          const ws = new WebSocket(j.listenUrl);
          wsRef.current = ws;
          ws.onmessage = (e) => {
            try {
              const m = JSON.parse(e.data as string);
              if (m.event === "media" && m.payload) player.play(m.payload);
              else if (m.event === "ended") stop();
            } catch {
              /* ignore malformed frame */
            }
          };
          ws.onerror = () => setError("Live audio connection error.");
          targetRef.current = target;
          setListeningKey(key);
          return;
        }

        setError("Could not start live audio.");
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Could not connect — allow microphone access to listen in.",
        );
      } finally {
        setBusyKey(null);
      }
    },
    [ensureDevice, listeningKey, stop],
  );

  // Full teardown on unmount — never leave a muted leg in someone's conference.
  useEffect(
    () => () => {
      teardown();
      try {
        deviceRef.current?.destroy();
      } catch {
        /* noop */
      }
      deviceRef.current = null;
    },
    [teardown],
  );

  return { listeningKey, busyKey, error, start, stop, setError };
}
