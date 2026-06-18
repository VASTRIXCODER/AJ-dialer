"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import type { CallOutcome, Lead } from "./types";
import { toE164 } from "./utils";

export type DialerStatus = "idle" | "dialing" | "live" | "wrapup";

export interface DialLine {
  id: string;
  lead: Lead;
  status: "ringing" | "connected" | "canceled" | "no_answer";
}

export interface DialerState {
  status: DialerStatus;
  lines: DialLine[];
  connectedLead: Lead | null;
  durationSec: number;
  muted: boolean;
  onHold: boolean;
  recording: boolean;
  autoDial: boolean;
  parallelCount: number;
  lastOutcome: CallOutcome | null;
  mode: "live" | "demo" | "connecting";
  callsThisSession: number;
  connectsThisSession: number;
  queueIndex: number;
}

const ANSWER_MIN_MS = 1200;
const ANSWER_MAX_MS = 3200;

export function useDialer(queue: Lead[]) {
  const [state, setState] = useState<DialerState>({
    status: "idle",
    lines: [],
    connectedLead: null,
    durationSec: 0,
    muted: false,
    onHold: false,
    recording: true,
    autoDial: false,
    parallelCount: 3,
    lastOutcome: null,
    mode: "connecting",
    callsThisSession: 0,
    connectsThisSession: 0,
    queueIndex: 0,
  });

  const queueIndexRef = useRef(0);
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const answerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoDialRef = useRef(false);
  const parallelRef = useRef(3);

  const patch = useCallback((p: Partial<DialerState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  const startTick = useCallback(() => {
    stopTick();
    tickRef.current = setInterval(() => {
      setState((s) => ({ ...s, durationSec: s.durationSec + 1 }));
    }, 1000);
  }, [stopTick]);

  // ── Initialize Twilio device (or fall back to demo mode) ──────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/twilio/token");
        const data = (await res.json()) as { token?: string; mode: string };
        if (cancelled) return;
        if (data.token) {
          const { Device } = await import("@twilio/voice-sdk");
          const device = new Device(data.token, { logLevel: "error" });
          await device.register();
          deviceRef.current = device;
          if (!cancelled) patch({ mode: "live" });
        } else {
          patch({ mode: "demo" });
        }
      } catch {
        if (!cancelled) patch({ mode: "demo" });
      }
    })();
    return () => {
      cancelled = true;
      deviceRef.current?.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      stopTick();
      if (answerTimerRef.current) clearTimeout(answerTimerRef.current);
    };
  }, [stopTick]);

  const nextLeads = useCallback(
    (count: number) => {
      const out: Lead[] = [];
      for (let i = 0; i < count; i++) {
        const lead = queue[(queueIndexRef.current + i) % queue.length];
        if (lead) out.push(lead);
      }
      return out;
    },
    [queue],
  );

  const connectLine = useCallback(
    (lead: Lead) => {
      patch({
        status: "live",
        connectedLead: lead,
        durationSec: 0,
      });
      setState((s) => ({
        ...s,
        connectsThisSession: s.connectsThisSession + 1,
        lines: s.lines.map((l) =>
          l.lead.id === lead.id
            ? { ...l, status: "connected" }
            : { ...l, status: "canceled" },
        ),
      }));
      startTick();
    },
    [patch, startTick],
  );

  // ── Start a (parallel) call attempt ───────────────────────────────────────
  const startCall = useCallback(
    async (override?: Lead[]) => {
      const count = parallelRef.current;
      const leads = override ?? nextLeads(count);
      if (!leads.length) return;

      const lines: DialLine[] = leads.map((lead) => ({
        id: `line-${lead.id}-${Date.now()}`,
        lead,
        status: "ringing",
      }));

      patch({
        status: "dialing",
        lines,
        connectedLead: null,
        durationSec: 0,
        muted: false,
        onHold: false,
        lastOutcome: null,
      });
      setState((s) => ({ ...s, callsThisSession: s.callsThisSession + 1 }));

      // Live, single-line: place a real call through the Voice SDK.
      if (deviceRef.current && leads.length === 1) {
        try {
          const call = await deviceRef.current.connect({
            params: { To: toE164(leads[0].phone), record: "true" },
          });
          callRef.current = call;
          call.on("accept", () => connectLine(leads[0]));
          call.on("disconnect", () => endCall());
          call.on("cancel", () => resetToIdle());
          call.on("reject", () => resetToIdle());
          call.on("error", () => resetToIdle());
          return;
        } catch {
          // fall through to simulated progression
        }
      }

      // Demo / parallel: simulate one line answering.
      const winner = leads[Math.floor(Math.random() * leads.length)];
      const delay =
        ANSWER_MIN_MS + Math.random() * (ANSWER_MAX_MS - ANSWER_MIN_MS);
      answerTimerRef.current = setTimeout(() => connectLine(winner), delay);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nextLeads, patch, connectLine],
  );

  const resetToIdle = useCallback(() => {
    stopTick();
    if (answerTimerRef.current) clearTimeout(answerTimerRef.current);
    callRef.current = null;
    patch({ status: "idle", lines: [], connectedLead: null, durationSec: 0 });
  }, [patch, stopTick]);

  const endCall = useCallback(() => {
    stopTick();
    if (answerTimerRef.current) clearTimeout(answerTimerRef.current);
    try {
      callRef.current?.disconnect();
    } catch {
      /* noop */
    }
    callRef.current = null;
    patch({ status: "wrapup" });
  }, [patch, stopTick]);

  const advanceQueue = useCallback(() => {
    queueIndexRef.current =
      (queueIndexRef.current + parallelRef.current) % Math.max(1, queue.length);
    patch({ queueIndex: queueIndexRef.current });
  }, [patch, queue.length]);

  const selectOutcome = useCallback(
    (outcome: CallOutcome) => {
      patch({ lastOutcome: outcome, status: "idle", lines: [], connectedLead: null });
      advanceQueue();
      if (autoDialRef.current) {
        setTimeout(() => startCall(), 900);
      }
    },
    [advanceQueue, patch, startCall],
  );

  const skip = useCallback(() => {
    if (answerTimerRef.current) clearTimeout(answerTimerRef.current);
    stopTick();
    try {
      callRef.current?.disconnect();
    } catch {
      /* noop */
    }
    callRef.current = null;
    advanceQueue();
    if (autoDialRef.current) {
      setTimeout(() => startCall(), 400);
    } else {
      patch({ status: "idle", lines: [], connectedLead: null, durationSec: 0 });
    }
  }, [advanceQueue, patch, startCall, stopTick]);

  const toggleMute = useCallback(() => {
    setState((s) => {
      const next = !s.muted;
      try {
        callRef.current?.mute(next);
      } catch {
        /* noop */
      }
      return { ...s, muted: next };
    });
  }, []);

  const toggleHold = useCallback(() => {
    setState((s) => ({ ...s, onHold: !s.onHold }));
  }, []);

  const toggleRecording = useCallback(() => {
    setState((s) => ({ ...s, recording: !s.recording }));
  }, []);

  const sendDigit = useCallback((digit: string) => {
    try {
      callRef.current?.sendDigits(digit);
    } catch {
      /* noop */
    }
  }, []);

  const setAutoDial = useCallback(
    (value: boolean) => {
      autoDialRef.current = value;
      patch({ autoDial: value });
    },
    [patch],
  );

  const setParallelCount = useCallback(
    (value: number) => {
      const clamped = Math.min(3, Math.max(1, value));
      parallelRef.current = clamped;
      patch({ parallelCount: clamped });
    },
    [patch],
  );

  return {
    state,
    startCall,
    endCall,
    selectOutcome,
    skip,
    toggleMute,
    toggleHold,
    toggleRecording,
    sendDigit,
    setAutoDial,
    setParallelCount,
  };
}
