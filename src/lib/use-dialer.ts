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

/** What the user knows about an ad-hoc number when there's no lead record. */
export interface KnownInfo {
  firstName?: string;
  lastName?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  utilityProvider?: string;
  solarProvider?: string;
  utilityBill?: number;
  solarPayment?: number;
  notes?: string;
}

export interface CallerIdInfo {
  callerId: string;
  pool: string[];
  poolIndex: number;
  rotateEvery: number;
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
  callSid: string | null;
  /** Conference room for the active manual call — links its recording. */
  room: string | null;
  /** Outbound call SIDs for the homeowner legs — used for hold/unhold. */
  outboundSids: string[];
  /** Which caller ID is active and rotation pool info — shown in session bar. */
  callerIdInfo: CallerIdInfo | null;
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
    callSid: null,
    room: null,
    outboundSids: [],
    callerIdInfo: null,
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
  const humanIdRef = useRef<string | null>(null);
  // Monotonically incremented on every AI session start/end so in-flight fetch
  // callbacks from a prior session can detect they're stale and skip setState.
  const sessionGenRef = useRef(0);
  // Whether manual PSTN dialing is possible (a Twilio caller ID is configured).
  const canDialOutRef = useRef(true);

  const patch = useCallback((p: Partial<DialerState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  // ── Human-call live presence (Live Monitor) ───────────────────────────────
  const postHuman = useCallback(
    (action: "connect", extra: Record<string, unknown> = {}) => {
      const id = humanIdRef.current;
      if (!id) return;
      fetch("/api/calls/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, id, ...extra }),
      }).catch(() => {});
    },
    [],
  );

  const clearHumanPresence = useCallback(() => {
    const id = humanIdRef.current;
    if (!id) return;
    humanIdRef.current = null;
    fetch("/api/calls/active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "end", id }),
      keepalive: true,
    }).catch(() => {});
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
          canDialOut?: boolean;
        };
        if (cancelled) return;
        if (data.token) {
          // Request mic permission BEFORE creating the Device. Browsers block
          // audio silently when permission is first asked mid-call; doing it here
          // (during the page load flow) shows the prompt while the user is still
          // actively setting up. We release the stream immediately — the SDK
          // re-acquires it when a call actually starts.
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach((t) => t.stop());
          } catch {
            // Permission denied or no mic — Device will still register; a real
            // call will fail at connect() and surface an actionable SDK error.
          }

          if (cancelled) return;

          const { Device, Call } = await import("@twilio/voice-sdk");
          const device = new Device(data.token, {
            logLevel: "error",
            // Prefer Opus (wideband, packet-loss resilient) then fall back to
            // PCMU. Without this the SDK may pick a codec that works for
            // signalling but produces no audio on certain browser/network paths.
            codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
          });
          await device.register();
          if (cancelled) {
            device.destroy();
            return;
          }
          deviceRef.current = device;
          identityRef.current = data.identity ?? "agent";
          canDialOutRef.current = data.canDialOut !== false;
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
      clearHumanPresence();
    },
    [stopTick, stopPoll, stopAITimer, clearHumanPresence],
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
      postHuman("connect");
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
    [postHuman, startTick, stopPoll],
  );

  const resetToIdle = useCallback(() => {
    stopTick();
    stopPoll();
    clearHumanPresence();
    callRef.current = null;
    patch({ status: "idle", lines: [], connectedLead: null, durationSec: 0 });
  }, [clearHumanPresence, patch, stopTick, stopPoll]);

  const endCall = useCallback(() => {
    stopTick();
    stopPoll();
    clearHumanPresence();
    const sid = callRef.current?.parameters?.CallSid ?? null;
    try {
      callRef.current?.disconnect();
    } catch {
      /* noop */
    }
    callRef.current = null;
    patch({ status: "wrapup", callSid: sid });
  }, [clearHumanPresence, patch, stopTick, stopPoll]);

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

  // ── Lead navigation (browse the queue without calling) ────────────────────
  const nextLead = useCallback(() => {
    if (!queue.length) return;
    queueIndexRef.current = (queueIndexRef.current + 1) % queue.length;
    patch({ queueIndex: queueIndexRef.current });
  }, [patch, queue.length]);

  const prevLead = useCallback(() => {
    if (!queue.length) return;
    queueIndexRef.current =
      (queueIndexRef.current - 1 + queue.length) % queue.length;
    patch({ queueIndex: queueIndexRef.current });
  }, [patch, queue.length]);

  const selectLead = useCallback(
    (leadId: string) => {
      const idx = queue.findIndex((l) => l.id === leadId);
      if (idx >= 0) {
        queueIndexRef.current = idx;
        patch({ queueIndex: idx });
      }
    },
    [patch, queue],
  );

  // ── AI calling (default) ──────────────────────────────────────────────────
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

    // Capture the session generation so stale callbacks from a prior session
    // (e.g. if endAISession() fires while fetch() is in-flight) are discarded.
    const gen = sessionGenRef.current;

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
          setState((s) => {
            if (sessionGenRef.current !== gen) return s;
            return {
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
            };
          });
        } catch {
          setState((s) => {
            if (sessionGenRef.current !== gen) return s;
            return {
              ...s,
              aiCalls: s.aiCalls.map((c) =>
                c.leadId === l.id && c.conversationId === null && !c.error
                  ? { ...c, error: "Network error" }
                  : c,
              ),
            };
          });
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
    sessionGenRef.current += 1;
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

  /** AI-dial an ad-hoc number with whatever the user knows about it. */
  const aiDialNumber = useCallback(
    async (phone: string, known: KnownInfo) => {
      const e164 = toE164(phone);
      if (e164.replace(/\D/g, "").length < 10) {
        patch({ error: "Enter a valid phone number." });
        return;
      }
      stopAITimer();
      const tempId = `manual-${Date.now().toString(36)}`;
      const name =
        `${known.firstName ?? ""} ${known.lastName ?? ""}`.trim() ||
        formatPhone(e164);
      setState((s) => ({
        ...s,
        status: "ai",
        error: null,
        aiCampaign: "idle",
        callsThisSession: s.callsThisSession + 1,
        aiCalls: [{ conversationId: null, leadId: tempId, leadName: name }],
      }));
      try {
        const res = await fetch("/api/elevenlabs/call", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ phone: e164, lead: known }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          conversationId?: string;
          error?: string;
        };
        setState((s) => ({
          ...s,
          aiCalls: s.aiCalls.map((c) =>
            c.leadId === tempId
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
            c.leadId === tempId ? { ...c, error: "Network error" } : c,
          ),
        }));
      }
    },
    [patch, stopAITimer],
  );

  // ── Human (Twilio) call attempt ───────────────────────────────────────────
  // Every human call runs through a Twilio conference (single = parallel-of-one):
  // the homeowner(s) are dialed into room `hc-<humanId>` and the rep's browser
  // joins the same room. This is what lets a supervisor live-listen by joining
  // the conference muted — no media relay required.
  const startHumanCall = useCallback(
    async (override?: Lead[]) => {
      if (modeRef.current !== "live" || !deviceRef.current) {
        patch({
          error: "Twilio isn't connected. Add your credentials to place calls.",
          status: "idle",
        });
        return;
      }

      if (!canDialOutRef.current) {
        patch({
          error:
            "Outbound calling needs Twilio REST credentials (Account SID, Auth Token, and Caller ID).",
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
        callSid: null,
        room: null,
        outboundSids: [],
      });
      setState((s) => ({ ...s, callsThisSession: s.callsThisSession + 1 }));

      // Register live presence for the Live Monitor. The conference room is
      // derived from this id so supervisors can join it to listen.
      const lead0 = leads[0];
      const humanId = `h-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      humanIdRef.current = humanId;
      const room = `hc-${humanId}`;
      // Persist the room so the disposition save can link the recording to it.
      patch({ room });
      fetch("/api/calls/active", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "start",
          id: humanId,
          leadName:
            leads.length > 1
              ? `${leads.length}× parallel dial`
              : `${lead0.firstName} ${lead0.lastName}`.trim() ||
                formatPhone(lead0.phone),
          city: [lead0.city, lead0.state].filter(Boolean).join(", "),
          phone: lead0.phone,
        }),
      }).catch(() => {});

      try {
        // Dial the homeowner(s) into the conference room via Twilio REST.
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
          clearHumanPresence();
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          patch({
            error: j.error ?? "Unable to start the call.",
            status: "idle",
            lines: [],
          });
          return;
        }
        const data = (await res.json().catch(() => ({}))) as {
          calls?: { leadId: string; sid: string | null; error?: string | null }[];
          errors?: (string | null)[];
          callerIdInfo?: { callerId: string; pool: string[]; poolIndex: number; rotateEvery: number } | null;
        };
        const placed = (data.calls ?? []).map((c) => ({
          leadId: c.leadId,
          sid: c.sid,
        }));
        // Store caller ID info for the rotation indicator and hold/unhold.
        if (data.callerIdInfo) {
          patch({ callerIdInfo: data.callerIdInfo });
        }
        const outboundSids = (data.calls ?? [])
          .map((c) => c.sid)
          .filter((s): s is string => Boolean(s));
        if (outboundSids.length) {
          patch({ outboundSids });
        }
        if (!placed.some((p) => p.sid)) {
          clearHumanPresence();
          // Surface the real Twilio rejection (e.g. unverified number on trial
          // account, invalid caller ID, geographic restriction, etc.) so the
          // team knows exactly what to fix rather than getting a generic message.
          const twilioMsg = (data.errors ?? []).filter(Boolean)[0];
          const errorMsg = twilioMsg
            ? `Call failed: ${twilioMsg}`
            : "Couldn't place the call. Check your Twilio number and credentials.";
          patch({
            error: errorMsg,
            status: "idle",
            lines: [],
          });
          return;
        }

        // Join the rep's browser into the same room (and record the conference).
        const call = await deviceRef.current.connect({
          params: { Conference: room, record: "true", MonitorId: humanId },
        });

        // The rep's browser is now in the conference, but the CALL is NOT
        // "connected" until the CUSTOMER actually answers. Poll Twilio for the
        // answered leg — works for single AND parallel — and flip to connected
        // only then. So the dialer + Live Monitor stay on "Dialing / Ringing"
        // until pickup (never a premature "connected"), the talk timer starts at
        // the real answer, and a no-answer cleanly wraps the attempt up.
        attachCallHandlers(call);
        stopPoll();
        let pollAttempts = 0;
        const pollAnswered = async () => {
          // 90 polls × 2 s = 3 minutes max. Treats a hung Twilio response as
          // no-answer so the rep isn't left waiting with no recourse.
          if (++pollAttempts > 90) {
            stopPoll();
            patch({ status: "idle", lines: [], error: "No answer — call timed out." });
            try { callRef.current?.disconnect(); } catch { /* noop */ }
            return;
          }
          try {
            const a = await fetch("/api/twilio/answered", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ legs: placed }),
            });
            const { answeredLeadId, done } = (await a.json()) as {
              answeredLeadId: string | null;
              done?: boolean;
            };
            if (answeredLeadId) {
              const lead = leads.find((l) => l.id === answeredLeadId) ?? leads[0];
              connectLine(lead); // connectLine stops the poll + starts the timer
            } else if (done) {
              // Nobody answered — release the rep from the empty conference.
              stopPoll();
              try {
                callRef.current?.disconnect();
              } catch {
                /* the disconnect handler wraps up */
              }
            }
          } catch {
            /* keep polling */
          }
        };
        pollRef.current = setInterval(pollAnswered, 2000);
      } catch {
        clearHumanPresence();
        patch({ error: "Call failed to start.", status: "idle", lines: [] });
        resetToIdle();
      }
    },
    [attachCallHandlers, clearHumanPresence, connectLine, nextLeads, patch, resetToIdle, stopPoll],
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
    (raw: string, displayName?: string) => {
      const e164 = toE164(raw);
      if (e164.replace(/\D/g, "").length < 10) {
        patch({ error: "Enter a valid phone number." });
        return;
      }
      const lead = manualLead(e164);
      if (displayName) {
        const parts = displayName.trim().split(/\s+/);
        lead.firstName = parts[0] ?? lead.firstName;
        lead.lastName = parts.slice(1).join(" ");
      }
      void startHumanCall([lead]); // manual dial is always human
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
      clearHumanPresence();
      patch({ lastOutcome: outcome, status: "idle", lines: [], connectedLead: null });
      advanceQueue();
      if (autoDialRef.current && queue.length) {
        setTimeout(() => startCall(), 900);
      }
    },
    [advanceQueue, clearHumanPresence, patch, queue.length, startCall],
  );

  const skip = useCallback(() => {
    stopTick();
    stopPoll();
    clearHumanPresence();
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
  }, [advanceQueue, clearHumanPresence, patch, queue.length, startCall, stopPoll, stopTick]);

  const launchNextAI = useCallback(() => {
    void launchAIBatch();
  }, [launchAIBatch]);

  const stopAICampaign = useCallback(() => {
    stopAITimer();
    patch({ aiCampaign: "idle" });
  }, [patch, stopAITimer]);

  const endAISession = useCallback(() => {
    stopAITimer();
    sessionGenRef.current += 1;
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
    setState((s) => {
      const nextHold = !s.onHold;
      // Fire-and-forget: ask Twilio to hold/unhold the homeowner participant(s)
      // with hold music. Falls back gracefully if Twilio isn't configured.
      if (s.room) {
        fetch("/api/twilio/hold", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ room: s.room, sids: s.outboundSids, hold: nextHold }),
        }).catch(() => {});
      }
      return { ...s, onHold: nextHold };
    });
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
      // AI can only be turned ON when it's actually usable for this viewer
      // (configured + permitted); otherwise the dialer stays in manual mode.
      const next = value && aiConfiguredRef.current;
      aiModeRef.current = next;
      stopAITimer();
      clearHumanPresence();
      patch({ aiMode: next, status: "idle", aiCalls: [], aiCampaign: "idle" });
    },
    [clearHumanPresence, patch, stopAITimer],
  );

  return {
    state,
    startCall,
    dialNumber,
    aiDialNumber,
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
    nextLead,
    prevLead,
    selectLead,
  };
}
