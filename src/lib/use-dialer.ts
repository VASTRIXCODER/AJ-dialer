"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import type { CallOutcome, Lead } from "./types";
import { formatPhone, toE164 } from "./utils";

export type DialerStatus = "idle" | "dialing" | "live" | "wrapup" | "ai";
export type DialerMode = "connecting" | "live" | "offline";

export interface DialLine {
  id: string;
  lead: Lead;
  status: "ringing" | "connected" | "canceled" | "no_answer";
}

/** One AI call launched in the current dialer session. */
export interface AiLaunch {
  conversationId: string | null;
  leadId: string;
  leadName: string;
  error?: string;
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
  mode: DialerMode;
  callsThisSession: number;
  connectsThisSession: number;
  queueIndex: number;
  error: string | null;
  /** AI calling is the default; flip off for manual (human Twilio) dialing. */
  aiMode: boolean;
  aiCalls: AiLaunch[];
  aiCampaign: "idle" | "running" | "done";
}

/** Build a lightweight Lead for an ad-hoc manual dial (not a queued lead). */
function manualLead(e164: string): Lead {
  return {
    id: `manual-${Date.now().toString(36)}`,
    firstName: formatPhone(e164),
    lastName: "",
    phone: e164,
    address: "",
    city: "",
    state: "",
    zip: "",
    utilityProvider: "",
    solarProvider: "",
    status: "new",
    campaignId: "",
    hasEV: false,
    hasPool: false,
    hasBattery: false,
    multipleSystems: false,
    createdAt: new Date().toISOString(),
    timezone: "",
  };
}

export function useDialer(queue: Lead[], aiConfigured = false) {
  const [state, setState] = useState<DialerState>({
    status: "idle",
    lines: [],
    connectedLead: null,
    durationSec: 0,
    muted: false,
    onHold: false,
    recording: true,
    autoDial: false,
    parallelCount: 1,
    lastOutcome: null,
    mode: "connecting",
    callsThisSession: 0,
    connectsThisSession: 0,
    queueIndex: 0,
    error: null,
    aiMode: aiConfigured,
    aiCalls: [],
    aiCampaign: "idle",
  });

  const queueIndexRef = useRef(0);
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const identityRef = useRef<string>("agent");
  const autoDialRef = useRef(false);
  const parallelRef = useRef(1);
  const modeRef = useRef<DialerMode>("connecting");
  const aiModeRef = useRef(aiConfigured);
  const aiConfiguredRef = useRef(aiConfigured);
  const aiCursorRef = useRef(0);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const patch = useCallback((p: Partial<DialerState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  const stopTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
  }, []);

  const startTick = useCallback(() => {
    stopTick();
    tickRef.current = setInterval(() => {
      setState((s) => ({ ...s, durationSec: s.durationSec + 1 }));
    }, 1000);
  }, [stopTick]);

  const stopPoll = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const stopAITimer = useCallback(() => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    aiTimerRef.current = null;
  }, []);

  // ── Initialize Twilio device, or go offline (no simulation) ───────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/twilio/token");
        const data = (await res.json()) as {
          token?: string;
          identity?: string;
          mode: string;
        };
        if (cancelled) return;
        if (data.token) {
          const { Device } = await import("@twilio/voice-sdk");
          const device = new Device(data.token, { logLevel: "error" });
          await device.register();
          if (cancelled) {
            device.destroy();
            return;
          }
          deviceRef.current = device;
          identityRef.current = data.identity ?? "agent";
          modeRef.current = "live";
          patch({ mode: "live" });
        } else {
          modeRef.current = "offline";
          patch({ mode: "offline" });
        }
      } catch {
        if (!cancelled) {
          modeRef.current = "offline";
          patch({ mode: "offline" });
        }
      }
    })();
    return () => {
      cancelled = true;
      deviceRef.current?.destroy();
    };
  }, [patch]);

  useEffect(
    () => () => {
      stopTick();
      stopPoll();
      stopAITimer();
    },
    [stopTick, stopPoll, stopAITimer],
  );

  const nextLeads = useCallback(
    (count: number) => {
      const out: Lead[] = [];
      for (let i = 0; i < count && i < queue.length; i++) {
        const lead = queue[(queueIndexRef.current + i) % queue.length];
        if (lead) out.push(lead);
      }
      return out;
    },
    [queue],
  );

  const connectLine = useCallback(
    (lead: Lead) => {
      stopPoll();
      setState((s) => ({
        ...s,
        status: "live",
        connectedLead: lead,
        durationSec: 0,
        connectsThisSession: s.connectsThisSession + 1,
        lines: s.lines.map((l) =>
          l.lead.id === lead.id
            ? { ...l, status: "connected" }
            : { ...l, status: "canceled" },
        ),
      }));
      startTick();
    },
    [startTick, stopPoll],
  );

  const resetToIdle = useCallback(() => {
    stopTick();
    stopPoll();
    callRef.current = null;
    patch({ status: "idle", lines: [], connectedLead: null, durationSec: 0 });
  }, [patch, stopTick, stopPoll]);

  const endCall = useCallback(() => {
    stopTick();
    stopPoll();
    try {
      callRef.current?.disconnect();
    } catch {
      /* noop */
    }
    callRef.current = null;
    patch({ status: "wrapup" });
  }, [patch, stopTick, stopPoll]);

  const attachCallHandlers = useCallback(
    (call: Call, onAccept?: () => void) => {
      callRef.current = call;
      if (onAccept) call.on("accept", onAccept);
      call.on("disconnect", () => endCall());
      call.on("cancel", () => resetToIdle());
      call.on("reject", () => resetToIdle());
      call.on("error", () => resetToIdle());
    },
    [endCall, resetToIdle],
  );

  // ── AI calling (default) ──────────────────────────────────────────────────
  // Places ElevenLabs AI calls for the next N queued leads. The human oversees,
  // listens, and takes over from the Live Monitor. Auto-dial walks the queue.
  const launchAIBatch = useCallback(async () => {
    const start = aiCursorRef.current;
    const leads = queue.slice(start, start + parallelRef.current);
    if (!leads.length) {
      stopAITimer();
      patch({ status: "ai", aiCampaign: "done" });
      return;
    }
    aiCursorRef.current = start + leads.length;
    queueIndexRef.current = Math.min(
      aiCursorRef.current,
      Math.max(0, queue.length - 1),
    );

    const pending: AiLaunch[] = leads.map((l) => ({
      conversationId: null,
      leadId: l.id,
      leadName: `${l.firstName} ${l.lastName}`.trim() || formatPhone(l.phone),
    }));

    setState((s) => ({
      ...s,
      status: "ai",
      error: null,
      queueIndex: queueIndexRef.current,
      callsThisSession: s.callsThisSession + leads.length,
      aiCampaign: autoDialRef.current ? "running" : "idle",
      aiCalls: [...pending, ...s.aiCalls].slice(0, 40),
    }));

    await Promise.all(
      leads.map(async (l) => {
        try {
          const res = await fetch("/api/elevenlabs/call", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ leadId: l.id }),
          });
          const json = (await res.json().catch(() => ({}))) as {
            conversationId?: string;
            error?: string;
          };
          setState((s) => ({
            ...s,
            aiCalls: s.aiCalls.map((c) =>
              c.leadId === l.id && c.conversationId === null && !c.error
                ? {
                    ...c,
                    conversationId: json.conversationId ?? null,
                    error: res.ok ? undefined : json.error ?? "Call failed",
                  }
                : c,
            ),
          }));
        } catch {
          setState((s) => ({
            ...s,
            aiCalls: s.aiCalls.map((c) =>
              c.leadId === l.id && c.conversationId === null && !c.error
                ? { ...c, error: "Network error" }
                : c,
            ),
          }));
        }
      }),
    );

    if (autoDialRef.current && aiCursorRef.current < queue.length) {
      aiTimerRef.current = setTimeout(() => {
        void launchAIBatch();
      }, 8000);
    } else if (aiCursorRef.current >= queue.length) {
      patch({ aiCampaign: "done" });
    }
  }, [patch, queue, stopAITimer]);

  const startAISession = useCallback(() => {
    stopAITimer();
    aiCursorRef.current = queueIndexRef.current;
    setState((s) => ({
      ...s,
      status: "ai",
      aiCalls: [],
      aiCampaign: autoDialRef.current ? "running" : "idle",
      error: null,
    }));
    void launchAIBatch();
  }, [launchAIBatch, stopAITimer]);

  // ── Human (Twilio) call attempt ───────────────────────────────────────────
  const startHumanCall = useCallback(
    async (override?: Lead[]) => {
      if (modeRef.current !== "live" || !deviceRef.current) {
        patch({
          error: "Twilio isn't connected. Add your credentials to place calls.",
          status: "idle",
        });
        return;
      }

      const leads = override ?? nextLeads(parallelRef.current);
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
        error: null,
      });
      setState((s) => ({ ...s, callsThisSession: s.callsThisSession + 1 }));

      try {
        if (leads.length === 1) {
          const call = await deviceRef.current.connect({
            params: { To: toE164(leads[0].phone), record: "true" },
          });
          attachCallHandlers(call, () => connectLine(leads[0]));
        } else {
          const room = `room-${identityRef.current}-${Date.now().toString(36)}`;
          const res = await fetch("/api/twilio/call", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              room,
              agentIdentity: identityRef.current,
              leads: leads.map((l) => ({ leadId: l.id, phone: l.phone })),
            }),
          });
          if (!res.ok) {
            patch({ error: "Unable to start parallel dial.", status: "idle", lines: [] });
            return;
          }
          const call = await deviceRef.current.connect({
            params: { Conference: room },
          });
          attachCallHandlers(call);
          stopPoll();
          pollRef.current = setInterval(async () => {
            try {
              const a = await fetch(
                `/api/twilio/answered?room=${encodeURIComponent(room)}`,
              );
              const { answeredLeadId } = (await a.json()) as {
                answeredLeadId: string | null;
              };
              if (answeredLeadId) {
                const lead = leads.find((l) => l.id === answeredLeadId);
                if (lead) connectLine(lead);
                else stopPoll();
              }
            } catch {
              /* keep polling */
            }
          }, 1200);
        }
      } catch {
        patch({ error: "Call failed to start.", status: "idle", lines: [] });
        resetToIdle();
      }
    },
    [attachCallHandlers, connectLine, nextLeads, patch, resetToIdle, stopPoll],
  );

  // The Start button + auto-dial route through here, honoring the current mode.
  const startCall = useCallback(
    (override?: Lead[]) => {
      if (aiModeRef.current && aiConfiguredRef.current && !override) {
        startAISession();
        return;
      }
      void startHumanCall(override);
    },
    [startAISession, startHumanCall],
  );

  const dialNumber = useCallback(
    (raw: string) => {
      const e164 = toE164(raw);
      if (e164.replace(/\D/g, "").length < 10) {
        patch({ error: "Enter a valid phone number." });
        return;
      }
      void startHumanCall([manualLead(e164)]); // manual dial is always human
    },
    [patch, startHumanCall],
  );

  const advanceQueue = useCallback(() => {
    if (!queue.length) return;
    queueIndexRef.current =
      (queueIndexRef.current + parallelRef.current) % queue.length;
    patch({ queueIndex: queueIndexRef.current });
  }, [patch, queue.length]);

  const selectOutcome = useCallback(
    (outcome: CallOutcome) => {
      patch({ lastOutcome: outcome, status: "idle", lines: [], connectedLead: null });
      advanceQueue();
      if (autoDialRef.current && queue.length) {
        setTimeout(() => startCall(), 900);
      }
    },
    [advanceQueue, patch, queue.length, startCall],
  );

  const skip = useCallback(() => {
    stopTick();
    stopPoll();
    try {
      callRef.current?.disconnect();
    } catch {
      /* noop */
    }
    callRef.current = null;
    advanceQueue();
    if (autoDialRef.current && queue.length) {
      setTimeout(() => startCall(), 400);
    } else {
      patch({ status: "idle", lines: [], connectedLead: null, durationSec: 0 });
    }
  }, [advanceQueue, patch, queue.length, startCall, stopPoll, stopTick]);

  const launchNextAI = useCallback(() => {
    void launchAIBatch();
  }, [launchAIBatch]);

  const stopAICampaign = useCallback(() => {
    stopAITimer();
    patch({ aiCampaign: "idle" });
  }, [patch, stopAITimer]);

  const endAISession = useCallback(() => {
    stopAITimer();
    patch({ status: "idle", aiCalls: [], aiCampaign: "idle" });
  }, [patch, stopAITimer]);

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
      if (!value) {
        stopAITimer();
        setState((s) => (s.aiCampaign === "running" ? { ...s, aiCampaign: "idle" } : s));
      }
    },
    [patch, stopAITimer],
  );

  const setParallelCount = useCallback(
    (value: number) => {
      const clamped = Math.min(3, Math.max(1, value));
      parallelRef.current = clamped;
      patch({ parallelCount: clamped });
    },
    [patch],
  );

  const setAiMode = useCallback(
    (value: boolean) => {
      aiModeRef.current = value;
      stopAITimer();
      patch({ aiMode: value, status: "idle", aiCalls: [], aiCampaign: "idle" });
    },
    [patch, stopAITimer],
  );

  return {
    state,
    startCall,
    dialNumber,
    endCall,
    selectOutcome,
    skip,
    toggleMute,
    toggleHold,
    toggleRecording,
    sendDigit,
    setAutoDial,
    setParallelCount,
    setAiMode,
    launchNextAI,
    stopAICampaign,
    endAISession,
  };
}
