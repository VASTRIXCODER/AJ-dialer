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
  /** Running dial total for the whole local day — persists across refresh/logout. */
  dialsToday: number;
  queueIndex: number;
  /** Bumped every time auto-dial completes a full pass through the queue (either
   *  mode). The parent (dialer-client) watches this to refetch the dial queue
   *  from the server — dropping leads just dispositioned this pass — before
   *  starting the next pass, so "repeat the list" never blindly re-calls
   *  someone just marked not-interested/DNC/booked. */
  queueLap: number;
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

// ── Daily dial counter (persists across refresh / logout) ─────────────────────
// Reps wanted a running "dials today" total that survives closing the app or
// logging out — the per-session counter resets on every reload. We keep it in
// localStorage keyed by user + local calendar day, so it carries through the
// whole day on the same device and naturally resets at midnight.
const DIAL_KEY_PREFIX = "aj:dials:";

function localDayStr(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function dialStorageKey(userId?: string): string {
  return `${DIAL_KEY_PREFIX}${userId || "anon"}:${localDayStr()}`;
}

function readDialsToday(userId?: string): number {
  if (typeof window === "undefined") return 0;
  try {
    return Number(window.localStorage.getItem(dialStorageKey(userId))) || 0;
  } catch {
    return 0;
  }
}

function writeDialsToday(userId: string | undefined, value: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(dialStorageKey(userId), String(value));
  } catch {
    /* storage full / disabled — counter just won't persist */
  }
}

/** Drop dial-counter keys from previous days so storage doesn't grow. Only
 *  prunes keys whose day suffix isn't today, so a different user's same-day
 *  count on a shared device is left intact. */
function sweepOldDialKeys(): void {
  if (typeof window === "undefined") return;
  try {
    const today = localDayStr();
    const toRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(DIAL_KEY_PREFIX) && !k.endsWith(`:${today}`)) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* best-effort */
  }
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

export function useDialer(
  queue: Lead[],
  aiConfigured = false,
  userId?: string,
  /** Gate for the Twilio device. The dialer now lives in an app-wide provider so
   *  a call survives navigation; without this gate the device would initialize
   *  (and prompt for mic) for every user on every page. The provider flips this
   *  true only once the dialer is actually opened, and keeps it true after — so
   *  the device persists across route changes. */
  enabled = true,
) {
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
    dialsToday: 0,
    queueIndex: 0,
    queueLap: 0,
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
  // Daily dial counter — ref is the source of truth (seeded from localStorage),
  // mirrored to state.dialsToday for display. userIdRef keys the storage per rep.
  const dialsTodayRef = useRef(0);
  const userIdRef = useRef(userId);
  // Bumped on every device (re-)setup so async callbacks from a torn-down or
  // superseded Device can detect they're stale and bail instead of fighting.
  const deviceGenRef = useRef(0);
  // Source of truth for state.queueLap (see DialerState.queueLap).
  const queueLapRef = useRef(0);

  const patch = useCallback((p: Partial<DialerState>) => {
    setState((s) => ({ ...s, ...p }));
  }, []);

  // Increment the persisted daily dial total by n. Updates the ref + localStorage
  // synchronously; callers mirror dialsTodayRef.current into state for display.
  const recordDials = useCallback((n: number) => {
    dialsTodayRef.current += n;
    writeDialsToday(userIdRef.current, dialsTodayRef.current);
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

  // Fetch a fresh short-lived Voice access token from the server.
  const fetchVoiceToken = useCallback(async () => {
    try {
      const res = await fetch("/api/twilio/token", { cache: "no-store" });
      return (await res.json()) as {
        token?: string;
        identity?: string;
        mode: string;
        canDialOut?: boolean;
      };
    } catch {
      return null;
    }
  }, []);

  // ── Initialize (or re-initialize) the Twilio device ───────────────────────
  // Tokens are short-lived (1h). Without renewal the device silently goes dead
  // mid-shift — the homeowner-reported "dialer just stops letting me dial, even
  // after refresh." setupDevice() builds the Device AND wires its full lifecycle:
  //   • tokenWillExpire → fetch a new token and updateToken() in place (no drop)
  //   • error 20104/31205 (token expired/invalid) → full rebuild
  //   • unregistered → re-register
  // It's also the manual reconnect path, so a wedged device is always one tap
  // from recovery rather than requiring a reload (which Safari didn't always fix).
  const setupDevice = useCallback(async () => {
    const gen = ++deviceGenRef.current;
    try {
      deviceRef.current?.destroy();
    } catch {
      /* noop */
    }
    deviceRef.current = null;
    modeRef.current = "connecting";
    patch({ mode: "connecting", error: null });

    const data = await fetchVoiceToken();
    if (deviceGenRef.current !== gen) return;
    if (!data?.token) {
      modeRef.current = "offline";
      patch({ mode: "offline" });
      return;
    }

    // Request mic permission BEFORE creating the Device. Browsers (Safari most
    // strictly) block audio silently when permission is first asked mid-call;
    // doing it now, during setup, surfaces the prompt at a sane moment. We
    // release the stream immediately — the SDK re-acquires it per call.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* denied / no mic — register anyway; connect() will surface a real error */
    }
    if (deviceGenRef.current !== gen) return;

    try {
      const { Device, Call } = await import("@twilio/voice-sdk");
      const device = new Device(data.token, {
        logLevel: "error",
        // Prefer Opus (wideband, packet-loss resilient) then fall back to PCMU.
        // Without this the SDK may pick a codec that works for signalling but
        // produces no audio on certain browser/network paths.
        codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      });

      // Renew the token ~30s before it lapses so the device stays live all day.
      device.on("tokenWillExpire", async () => {
        if (deviceGenRef.current !== gen) return;
        const fresh = await fetchVoiceToken();
        if (deviceGenRef.current !== gen) return;
        if (fresh?.token) {
          try {
            device.updateToken(fresh.token);
          } catch {
            /* updateToken can throw if the device is mid-teardown */
          }
        }
      });

      device.on("registered", () => {
        if (deviceGenRef.current !== gen) return;
        modeRef.current = "live";
        patch({ mode: "live" });
      });

      device.on("unregistered", () => {
        // A network blip or token lapse dropped the registration. Don't disturb
        // an active call; otherwise try to bring it back so dialing recovers.
        if (deviceGenRef.current !== gen || callRef.current) return;
        device.register().catch(() => {});
      });

      device.on("error", (err: { code?: number }) => {
        if (deviceGenRef.current !== gen) return;
        // Access token expired/invalid → rebuild from a fresh token.
        if (err?.code === 20104 || err?.code === 31205) {
          void setupDeviceRef.current?.();
          return;
        }
        // Other fatal errors with no live call → mark offline so the UI offers
        // the Reconnect button instead of looking falsely "live".
        if (!callRef.current) {
          modeRef.current = "offline";
          patch({ mode: "offline" });
        }
      });

      await device.register();
      if (deviceGenRef.current !== gen) {
        device.destroy();
        return;
      }
      deviceRef.current = device;
      identityRef.current = data.identity ?? "agent";
      canDialOutRef.current = data.canDialOut !== false;
      modeRef.current = "live";
      patch({ mode: "live" });
    } catch {
      if (deviceGenRef.current !== gen) return;
      modeRef.current = "offline";
      patch({ mode: "offline" });
    }
  }, [fetchVoiceToken, patch]);

  // Stable indirection so lifecycle handlers can re-invoke the latest setup.
  const setupDeviceRef = useRef(setupDevice);
  useEffect(() => {
    setupDeviceRef.current = setupDevice;
  }, [setupDevice]);

  // Manual recovery — surfaced as a "Reconnect" button when the device is offline.
  const reconnect = useCallback(() => {
    void setupDevice();
  }, [setupDevice]);

  useEffect(() => {
    // Only build the Twilio device once the dialer is actually in use. Flips
    // true on first activation and stays true, so the device (and any live
    // call) persists across navigation instead of tearing down per page.
    if (!enabled) return;
    void setupDevice();
    return () => {
      // Invalidate in-flight callbacks and tear the device down on unmount.
      deviceGenRef.current += 1;
      try {
        deviceRef.current?.destroy();
      } catch {
        /* noop */
      }
      deviceRef.current = null;
    };
  }, [setupDevice, enabled]);

  // ── Seed the daily dial counter from storage (per rep, per local day) ──────
  useEffect(() => {
    userIdRef.current = userId;
    const n = readDialsToday(userId);
    dialsTodayRef.current = n;
    setState((s) => ({ ...s, dialsToday: n }));
    sweepOldDialKeys();
  }, [userId]);

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

    recordDials(leads.length);
    setState((s) => ({
      ...s,
      status: "ai",
      error: null,
      queueIndex: queueIndexRef.current,
      callsThisSession: s.callsThisSession + leads.length,
      dialsToday: dialsTodayRef.current,
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
      // Reached the end of this pass. Bump queueLap so the parent (which owns
      // fetching the queue) refetches — dropping anything just dispositioned
      // this pass — and restarts via restartAutoDialLap() when auto-dial is
      // on. If auto-dial is off, this just leaves the campaign at "done".
      queueLapRef.current += 1;
      patch({ aiCampaign: "done", queueLap: queueLapRef.current });
    }
  }, [patch, queue, recordDials, stopAITimer]);

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
      recordDials(1);
      setState((s) => ({
        ...s,
        status: "ai",
        error: null,
        aiCampaign: "idle",
        callsThisSession: s.callsThisSession + 1,
        dialsToday: dialsTodayRef.current,
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
    [patch, recordDials, stopAITimer],
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
      recordDials(1);
      setState((s) => ({
        ...s,
        callsThisSession: s.callsThisSession + 1,
        dialsToday: dialsTodayRef.current,
      }));

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
    [attachCallHandlers, clearHumanPresence, connectLine, nextLeads, patch, recordDials, resetToIdle, stopPoll],
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

  /**
   * Begin a fresh pass through the (freshly-refetched) queue after auto-dial
   * completes a lap. Called by the parent once it's confirmed there's still
   * something dialable — resets the queue position to the top so AI mode's
   * cursor (which reads off queueIndexRef) and manual mode's nextLeads() both
   * start from lead 0 of the new list, instead of picking up from wherever
   * the exhausted previous pass left off.
   */
  const restartAutoDialLap = useCallback(() => {
    queueIndexRef.current = 0;
    patch({ queueIndex: 0 });
    startCall();
  }, [patch, startCall]);

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

  // True when the CURRENT queue position is the last one this pass will touch
  // — i.e. advanceQueue() is about to wrap back toward the start. Must be
  // read BEFORE advanceQueue() moves the index.
  const isCompletingLap = useCallback(
    () => queue.length > 0 && queueIndexRef.current + parallelRef.current >= queue.length,
    [queue.length],
  );

  const selectOutcome = useCallback(
    (outcome: CallOutcome) => {
      clearHumanPresence();
      const completingLap = isCompletingLap();
      patch({ lastOutcome: outcome, status: "idle", lines: [], connectedLead: null });
      advanceQueue();
      if (autoDialRef.current && queue.length) {
        if (completingLap) {
          // Reached the end of this pass. Don't blindly re-dial the same
          // static, possibly-stale array (it would include leads just
          // dispositioned as not_interested/DNC/booked moments ago in this
          // same pass). Bump queueLap — the parent refetches the dial queue
          // and calls restartAutoDialLap() once it confirms there's still
          // something dialable.
          queueLapRef.current += 1;
          patch({ queueLap: queueLapRef.current });
        } else {
          setTimeout(() => startCall(), 900);
        }
      }
    },
    [advanceQueue, clearHumanPresence, isCompletingLap, patch, queue.length, startCall],
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
    const completingLap = isCompletingLap();
    advanceQueue();
    if (autoDialRef.current && queue.length) {
      if (completingLap) {
        queueLapRef.current += 1;
        patch({ status: "idle", lines: [], connectedLead: null, durationSec: 0, queueLap: queueLapRef.current });
      } else {
        setTimeout(() => startCall(), 400);
      }
    } else {
      patch({ status: "idle", lines: [], connectedLead: null, durationSec: 0 });
    }
  }, [advanceQueue, clearHumanPresence, isCompletingLap, patch, queue.length, startCall, stopPoll, stopTick]);

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
    restartAutoDialLap,
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
    reconnect,
  };
}
