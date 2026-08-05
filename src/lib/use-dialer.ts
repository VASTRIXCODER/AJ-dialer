"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Call, Device } from "@twilio/voice-sdk";
import type { AgentKey } from "./elevenlabs";
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
  /** The outbound caller ID this call was actually placed from. */
  callerId?: string | null;
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
  /** Ceiling for parallelCount in the CURRENT mode (human 3, AI = plan limit). */
  maxParallel: number;
  lastOutcome: CallOutcome | null;
  mode: DialerMode;
  /** The active call's media briefly dropped and the Twilio SDK is auto-recovering
   *  it. The call is NOT over — this rides out a transient blip instead of letting
   *  it read as a dead call the rep hangs up on. */
  reconnecting: boolean;
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
  /** Numbers the rep toggled off in the dialer's caller-ID picker; empty means
   *  every pool number is eligible (default — matches today's full rotation). */
  excludedCallerIds: string[];
  /** AI calling is the default; flip off for manual (human Twilio) dialing. */
  aiMode: boolean;
  /** Which AI persona AI calls dial as. Only meaningful when a second agent is
   *  configured; otherwise it's always "primary". */
  activeAgent: AgentKey;
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

// ── Excluded caller IDs (persists across refresh / logout) ────────────────────
// Which pool numbers a rep has toggled OFF in the dialer's caller-ID picker.
// Keyed by user only (no day component — unlike dialsToday, this isn't meant
// to reset daily). Stale entries (a number since removed from the org pool)
// are harmless: the server only ever intersects this against the live pool.
const EXCLUDED_CALLER_ID_KEY_PREFIX = "aj:excludedCallerIds:";

function excludedCallerIdStorageKey(userId?: string): string {
  return `${EXCLUDED_CALLER_ID_KEY_PREFIX}${userId || "anon"}`;
}

function readExcludedCallerIds(userId?: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(excludedCallerIdStorageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === "string") : [];
  } catch {
    return [];
  }
}

function writeExcludedCallerIds(userId: string | undefined, value: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(excludedCallerIdStorageKey(userId), JSON.stringify(value));
  } catch {
    /* storage full / disabled — the choice just won't persist */
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

// ── Concurrency ──────────────────────────────────────────────────────────────
/**
 * How often the pump checks for a FREE LINE. This is a poll interval, not a
 * launch interval — the old code launched a whole fresh batch on every tick,
 * which is what turned a "3 concurrent" setting into ~22 calls a minute.
 */
const AI_PUMP_MS = 5_000;
/**
 * A slot is force-released after this long. A call that never reports a terminal
 * state would otherwise hold its line forever and stall the campaign at N-1.
 */
const AI_SLOT_MAX_MS = 12 * 60_000;

/** A human rep can only talk to one answered line — more just abandons calls. */
export const MAX_PARALLEL_HUMAN = 3;
/** Platform ceiling for AI concurrency; the org's plan limit applies on top. */
export const MAX_PARALLEL_AI = 30;

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
  /** The org's AI concurrency allowance (their voice plan's live-call limit). */
  maxAiConcurrency = 10,
  /** AI double-dial: re-ring a NO-ANSWER once, `doubleDialGapSec` later, before
   *  moving on. Two quick missed calls read as important and lift pickup. */
  doubleDial = false,
  doubleDialGapSec = 15,
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
    maxParallel: aiConfigured ? maxAiConcurrency : MAX_PARALLEL_HUMAN,
    lastOutcome: null,
    mode: "connecting",
    reconnecting: false,
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
    excludedCallerIds: [],
    aiMode: aiConfigured,
    activeAgent: "primary",
    aiCalls: [],
    aiCampaign: "idle",
  });

  const queueIndexRef = useRef(0);
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  /**
   * A token-expiry error (20104/31205) that arrived WHILE a call was live. The
   * fix for that error is to rebuild the Device — but rebuilding destroys it,
   * which would drop the very call the rep is on. So we defer: flag it here and
   * rebuild the instant the call ends (see endCall/resetToIdle), never during.
   */
  const pendingRebuildRef = useRef(false);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const presenceSnapshotRef = useRef<{
    status: DialerStatus;
    lead: { name?: string; city?: string; phone?: string } | null;
    aiActiveCount: number;
  }>({ status: "idle", lead: null, aiActiveCount: 0 });
  const identityRef = useRef<string>("agent");
  const autoDialRef = useRef(false);
  const parallelRef = useRef(1);
  const modeRef = useRef<DialerMode>("connecting");
  const aiModeRef = useRef(aiConfigured);
  const activeAgentRef = useRef<AgentKey>("primary");
  const excludedCallerIdsRef = useRef<string[]>([]);
  const aiConfiguredRef = useRef(aiConfigured);
  const aiCursorRef = useRef(0);
  /**
   * Conversations we've launched that haven't finished. THIS is what makes
   * `parallelCount` an actual concurrency limit rather than a batch size.
   */
  const inflightRef = useRef<Set<string>>(new Set());
  /** When each slot was taken — so a call that never ends can't hold one forever. */
  const slotAgeRef = useRef<Map<string, number>>(new Map());
  const maxAiRef = useRef(maxAiConcurrency);
  useEffect(() => {
    maxAiRef.current = maxAiConcurrency;
  }, [maxAiConcurrency]);
  // ── AI double-dial (double-tap) ────────────────────────────────────────────
  const doubleDialRef = useRef(doubleDial);
  const doubleDialGapMsRef = useRef(Math.max(5, doubleDialGapSec) * 1000);
  useEffect(() => {
    doubleDialRef.current = doubleDial;
    doubleDialGapMsRef.current = Math.max(5, doubleDialGapSec) * 1000;
  }, [doubleDial, doubleDialGapSec]);
  /** How many times we've dialed each lead THIS session (1 = first, 2 = the tap). */
  const attemptsRef = useRef<Map<string, number>>(new Map());
  /** conversationId → the lead it was for, so a no-answer can find its lead to re-ring. */
  const convLeadRef = useRef<Map<string, Lead>>(new Map());
  /** Leads waiting for their second (double-tap) dial, keyed by lead id. Each also
   *  holds a `redial:<id>` slot in inflightRef through the gap, so the pump keeps a
   *  line free for the re-ring instead of racing ahead to the next lead. */
  const redialsRef = useRef<Map<string, { dueAt: number; lead: Lead }>>(new Map());
  /** Fires each pending re-ring at its own due time (see tickRedials). */
  const redialTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // Screen Wake Lock held while a dialing session is active, so a rep's phone
  // doesn't suspend the tab (and drop the Twilio websocket) mid-session.
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

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

  /**
   * Hang up outbound legs we placed but can no longer bridge the rep into.
   * Fire-and-forget: the rep is already back at idle, and an abandoned call
   * ringing a real person is worse than a failed cleanup request.
   */
  const releaseLegs = useCallback((sids: string[]) => {
    if (!sids.length) return;
    fetch("/api/twilio/release", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sids }),
      keepalive: true,
    }).catch(() => {});
  }, []);

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

  // ── Per-user live presence (manager Team Status roster) ──────────────────
  const postPresence = useCallback(
    (
      status: DialerStatus,
      lead: { name?: string; city?: string; phone?: string } | null,
      aiActiveCount: number,
    ) => {
      fetch("/api/team/presence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, lead, aiActiveCount }),
      }).catch(() => {});
    },
    [],
  );

  const clearMyPresence = useCallback(() => {
    fetch("/api/team/presence", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "offline" }),
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
        // an active call (its media is a separate connection). Otherwise reflect
        // the drop HONESTLY — a device left reading "Twilio Live" while actually
        // dead is exactly why reps saw "it doesn't say I'm live" / "offline" and
        // had to reload — then try to bring it back so dialing recovers on its own.
        if (deviceGenRef.current !== gen || callRef.current) return;
        modeRef.current = "connecting";
        patch({ mode: "connecting" });
        device.register().catch(() => {
          if (deviceGenRef.current !== gen || callRef.current) return;
          modeRef.current = "offline";
          patch({ mode: "offline" });
        });
      });

      device.on("error", (err: { code?: number }) => {
        if (deviceGenRef.current !== gen) return;
        // Access token expired/invalid → rebuild from a fresh token. But a rebuild
        // DESTROYS the device, and destroying it mid-call hangs up the rep on a
        // live homeowner — the exact "the phone just cuts off while I'm talking"
        // failure. If a call is up, defer: rebuild the moment it ends (endCall/
        // resetToIdle consume this flag), never during. The live call's media is a
        // separate PeerConnection that a lapsed *registration* token doesn't sever.
        if (err?.code === 20104 || err?.code === 31205) {
          if (callRef.current) {
            pendingRebuildRef.current = true;
            return;
          }
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

  // Verify the device is actually registered and recover if not. Called on the
  // three moments a silently-dropped websocket would otherwise strand the dialer
  // "offline" until a manual reload: the rep returning to a backgrounded tab, the
  // network coming back, and a periodic health check. Never disturbs a live call.
  const ensureRegistered = useCallback(async () => {
    if (!enabled || callRef.current) return;
    const device = deviceRef.current;
    if (!device || String(device.state) !== "registered") {
      await setupDeviceRef.current?.();
      return;
    }
    // Registered, but a token can lapse while the tab is frozen (a throttled timer
    // never fires tokenWillExpire) — refresh so the next dial isn't rejected on a
    // stale token.
    try {
      const fresh = await fetchVoiceToken();
      if (fresh?.token) device.updateToken(fresh.token);
    } catch {
      /* the tokenWillExpire event + the re-register branch above are backstops */
    }
  }, [enabled, fetchVoiceToken]);

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

  // ── Recover the device on resume (backgrounding fix) ──────────────────────
  // Mobile browsers freeze a backgrounded tab and tear down its websocket, so a
  // rep who switched apps and came back found the dialer "offline" and had to
  // fully exit + reload. Re-check registration on every resume signal instead.
  // Debounced because one "return to tab" fires a burst (visibilitychange +
  // focus + pageshow) that should collapse into a single recovery attempt.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const kick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void ensureRegistered(), 400);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") kick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", kick);
    window.addEventListener("focus", kick);
    window.addEventListener("online", kick);
    return () => {
      if (debounce) clearTimeout(debounce);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", kick);
      window.removeEventListener("focus", kick);
      window.removeEventListener("online", kick);
    };
  }, [enabled, ensureRegistered]);

  // Periodic health check — catches a device that died while the tab STAYED open
  // (a silent drop that emitted no unregistered/error event); the resume signals
  // above would never see that. Cheap: only re-registers when actually needed.
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => void ensureRegistered(), 25_000);
    return () => clearInterval(id);
  }, [enabled, ensureRegistered]);

  // Hold a Screen Wake Lock while a session is active, so a rep's phone doesn't
  // dim → suspend the tab → drop the call. Best-effort (unsupported browsers skip
  // it); re-acquired on visibility since the lock auto-releases when hidden.
  const sessionActive = state.status !== "idle";
  useEffect(() => {
    if (!sessionActive) return;
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let released = false;
    const acquire = async () => {
      try {
        if (document.visibilityState !== "visible" || wakeLockRef.current) return;
        const lock = await navigator.wakeLock.request("screen");
        if (released) {
          void lock.release().catch(() => {});
          return;
        }
        wakeLockRef.current = lock;
        lock.addEventListener("release", () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null;
        });
      } catch {
        /* denied / unsupported — not critical */
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      const lock = wakeLockRef.current;
      wakeLockRef.current = null;
      if (lock) void lock.release().catch(() => {});
    };
  }, [sessionActive]);

  // Report status + current lead on every change, and keep a steady heartbeat
  // (independent of state changes) so a rep sitting genuinely idle doesn't age
  // past the roster's staleness window and vanish from a manager's view.
  useEffect(() => {
    if (!enabled) return;
    const lead = state.connectedLead
      ? {
          name: `${state.connectedLead.firstName} ${state.connectedLead.lastName}`.trim(),
          city: [state.connectedLead.city, state.connectedLead.state].filter(Boolean).join(", "),
          phone: state.connectedLead.phone,
        }
      : state.aiCalls[0]
        ? { name: state.aiCalls[0].leadName }
        : null;
    const aiActiveCount = state.status === "ai" ? state.aiCalls.length : 0;
    presenceSnapshotRef.current = { status: state.status, lead, aiActiveCount };
    postPresence(state.status, lead, aiActiveCount);
    // aiCalls.length (not the array itself) so a per-lead mutation mid-batch
    // doesn't fire a POST per lead — only when the concurrent count changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, state.status, state.connectedLead, state.aiCalls.length, postPresence]);

  useEffect(() => {
    if (!enabled) return;
    presenceTimerRef.current = setInterval(() => {
      const snap = presenceSnapshotRef.current;
      postPresence(snap.status, snap.lead, snap.aiActiveCount);
    }, 20_000);
    return () => {
      if (presenceTimerRef.current) clearInterval(presenceTimerRef.current);
      presenceTimerRef.current = null;
    };
  }, [enabled, postPresence]);

  // ── Seed the daily dial counter from storage (per rep, per local day) ──────
  useEffect(() => {
    userIdRef.current = userId;
    const n = readDialsToday(userId);
    dialsTodayRef.current = n;
    setState((s) => ({ ...s, dialsToday: n }));
    sweepOldDialKeys();
  }, [userId]);

  // ── Seed excluded caller IDs from storage (per rep, no expiry) ─────────────
  useEffect(() => {
    const excluded = readExcludedCallerIds(userId);
    excludedCallerIdsRef.current = excluded;
    setState((s) => ({ ...s, excludedCallerIds: excluded }));
  }, [userId]);

  useEffect(
    () => () => {
      stopTick();
      stopPoll();
      stopAITimer();
      // Clear the double-tap timer directly (purgeRedials is declared later, and
      // on unmount the whole hook goes anyway — only the live timer needs killing).
      if (redialTimerRef.current) clearTimeout(redialTimerRef.current);
      clearHumanPresence();
      clearMyPresence();
    },
    [stopTick, stopPoll, stopAITimer, clearHumanPresence, clearMyPresence],
  );

  /**
   * Keep the queue cursor pointing INSIDE the current queue, wrapping back to
   * the top when it has fallen off the end. Returns the usable cursor.
   *
   * The cursor routinely outlives the list it was set against: an AI pass parks
   * it at exactly `queue.length` when it runs out of leads, `loadLeads()` can
   * hand back a shorter list than last time, and the group / campaign / "my
   * leads" filters narrow the queue underneath it. Nothing used to bring it back
   * in range, and `nextLeads()` slices from it without wrapping — so a stale
   * cursor made "Start session" find NOTHING to dial and bail out instantly.
   * That is the "I press start, it never dials, and it drops straight back to
   * idle" report: the lead panel still showed a lead (it indexes with a modulo
   * the engine itself never applied), so the queue looked perfectly fine.
   */
  const normalizeCursor = useCallback(() => {
    if (queueIndexRef.current >= queue.length || queueIndexRef.current < 0) {
      queueIndexRef.current = 0;
      setState((s) => (s.queueIndex === 0 ? s : { ...s, queueIndex: 0 }));
    }
    return queueIndexRef.current;
  }, [queue.length]);

  // Re-anchor whenever the loaded queue changes size, so the cursor can never be
  // left stranded past the end of a freshly-loaded or freshly-filtered list.
  useEffect(() => {
    normalizeCursor();
  }, [normalizeCursor]);

  /**
   * The next `count` leads. Does NOT wrap WITHIN a batch.
   *
   * This used to index `queue[(i + n) % queue.length]`, so a 2-lead queue dialed
   * at 3X produced [lead0, lead1, lead0] — the same homeowner rung twice, on two
   * lines, simultaneously, from a single batch. Running short at the end of the
   * queue means fewer lines this round, not calling someone twice.
   * (Lapping the whole list is handled deliberately elsewhere, via queueLap.)
   */
  const nextLeads = useCallback(
    (count: number) => {
      if (!queue.length) return [];
      const start = normalizeCursor();
      return queue.slice(start, start + count);
    },
    [normalizeCursor, queue],
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

  // A token-expiry error that arrived mid-call deferred its device rebuild so it
  // wouldn't drop the call. The call is over now — honor it, so the device
  // recovers instead of quietly running on a stale/expired token.
  const consumePendingRebuild = useCallback(() => {
    if (!pendingRebuildRef.current) return;
    pendingRebuildRef.current = false;
    void setupDeviceRef.current?.();
  }, []);

  const resetToIdle = useCallback(() => {
    stopTick();
    stopPoll();
    clearHumanPresence();
    callRef.current = null;
    patch({ status: "idle", lines: [], connectedLead: null, durationSec: 0, reconnecting: false });
    consumePendingRebuild();
  }, [clearHumanPresence, consumePendingRebuild, patch, stopTick, stopPoll]);

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
    patch({ status: "wrapup", callSid: sid, reconnecting: false });
    consumePendingRebuild();
  }, [clearHumanPresence, consumePendingRebuild, patch, stopTick, stopPoll]);

  const attachCallHandlers = useCallback(
    (call: Call, onAccept?: () => void) => {
      callRef.current = call;
      if (onAccept) call.on("accept", onAccept);
      call.on("disconnect", () => endCall());
      call.on("cancel", () => resetToIdle());
      call.on("reject", () => resetToIdle());
      call.on("error", () => {
        // The SDK fires `error` for many conditions, not all of them fatal. When a
        // call is genuinely ending it ALSO fires `disconnect` (→ endCall), which
        // wraps up cleanly — so this handler tearing the call down too is at best
        // redundant. On a RECOVERABLE error, though, resetting here abandons a call
        // the customer is still on: the rep's screen drops to idle while they're
        // actually still connected, which reads as "the call just cut off." Only
        // reset when the call is truly closed; otherwise let `disconnect` decide.
        try {
          if (callRef.current && callRef.current.status() !== "closed") return;
        } catch {
          /* status() unavailable — fall through and reset */
        }
        resetToIdle();
      });
      // Transient media/signaling blip: the SDK is auto-recovering the SAME call
      // leg — it is NOT over. Ride it out (show "Reconnecting…") rather than let a
      // 2-second wobble read as a dropped call. If recovery ultimately fails the
      // SDK fires `disconnect`, which wraps up normally.
      call.on("reconnecting", () => patch({ reconnecting: true }));
      call.on("reconnected", () => patch({ reconnecting: false }));
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

  /** Abandon every pending double-tap re-ring (out of credits, session ended, …). */
  const purgeRedials = useCallback(() => {
    if (redialTimerRef.current) {
      clearTimeout(redialTimerRef.current);
      redialTimerRef.current = null;
    }
    for (const leadId of redialsRef.current.keys()) {
      inflightRef.current.delete(`redial:${leadId}`);
      slotAgeRef.current.delete(`redial:${leadId}`);
    }
    redialsRef.current.clear();
  }, []);

  /**
   * Place ONE AI call for a lead — the shared dial used by BOTH the new-lead pump
   * and the double-tap re-ring, so an attempt and its re-ring behave identically
   * (same reservation, credit-halt handling, live-call bookkeeping). Reserves the
   * line up front, counts the dial + the per-lead attempt, then swaps the
   * reservation for the real conversation id (recording which lead it was for, so
   * a no-answer can find its way back here for the tap).
   */
  const launchAICall = useCallback(
    async (l: Lead, gen: number) => {
      const slotKey = `lead:${l.id}`;
      inflightRef.current.add(slotKey);
      slotAgeRef.current.set(slotKey, Date.now());
      attemptsRef.current.set(l.id, (attemptsRef.current.get(l.id) ?? 0) + 1);
      recordDials(1);
      const leadName = `${l.firstName} ${l.lastName}`.trim() || formatPhone(l.phone);
      setState((s) =>
        sessionGenRef.current !== gen
          ? s
          : {
              ...s,
              status: "ai",
              error: null,
              callsThisSession: s.callsThisSession + 1,
              dialsToday: dialsTodayRef.current,
              aiCampaign: autoDialRef.current ? "running" : s.aiCampaign,
              aiCalls: [
                { conversationId: null, leadId: l.id, leadName },
                ...s.aiCalls,
              ].slice(0, 40),
            },
      );
      try {
        const res = await fetch("/api/elevenlabs/call", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            leadId: l.id,
            agent: activeAgentRef.current,
            excludedCallerIds: excludedCallerIdsRef.current.length
              ? excludedCallerIdsRef.current
              : undefined,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          conversationId?: string;
          error?: string;
          halted?: boolean;
          callerId?: string | null;
        };

        // The server REFUSED to dial (out of credits / breaker open). Stop the
        // whole campaign — including any owed re-rings — every further call would
        // fail identically and spend a real homeowner for nothing.
        if (json.halted) {
          inflightRef.current.delete(slotKey);
          slotAgeRef.current.delete(slotKey);
          stopAITimer();
          autoDialRef.current = false;
          purgeRedials();
          setState((s) =>
            sessionGenRef.current !== gen
              ? s
              : {
                  ...s,
                  autoDial: false,
                  aiCampaign: "idle",
                  error: json.error ?? "AI dialing halted.",
                },
          );
          return;
        }

        inflightRef.current.delete(slotKey);
        slotAgeRef.current.delete(slotKey);
        if (res.ok && json.conversationId) {
          inflightRef.current.add(json.conversationId);
          slotAgeRef.current.set(json.conversationId, Date.now());
          convLeadRef.current.set(json.conversationId, l);
        }
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
                    callerId: json.callerId ?? null,
                  }
                : c,
            ),
          };
        });
      } catch {
        inflightRef.current.delete(slotKey);
        slotAgeRef.current.delete(slotKey);
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
    },
    [purgeRedials, recordDials, stopAITimer],
  );

  /**
   * Fire every DUE double-tap re-ring, then re-arm for the next one at its exact
   * due time. Runs on its own timer (not the new-lead pump) so a re-ring lands
   * ~gap seconds after the miss even at one line at a time, and even when
   * auto-dial is off. Each re-ring gave up its reserved `redial:` slot for a live
   * line here, so it never exceeds the concurrency ceiling.
   */
  const tickRedials = useCallback(() => {
    if (redialTimerRef.current) {
      clearTimeout(redialTimerRef.current);
      redialTimerRef.current = null;
    }
    if (!redialsRef.current.size) return;
    const now = Date.now();
    const gen = sessionGenRef.current;
    let soonest = Infinity;
    for (const [leadId, r] of [...redialsRef.current.entries()]) {
      if (r.dueAt <= now) {
        redialsRef.current.delete(leadId);
        inflightRef.current.delete(`redial:${leadId}`);
        slotAgeRef.current.delete(`redial:${leadId}`);
        void launchAICall(r.lead, gen);
      } else {
        soonest = Math.min(soonest, r.dueAt);
      }
    }
    if (redialsRef.current.size && soonest < Infinity) {
      redialTimerRef.current = setTimeout(
        () => tickRedials(),
        Math.max(250, soonest - Date.now()),
      );
    }
  }, [launchAICall]);
  const tickRedialsRef = useRef(tickRedials);
  useEffect(() => {
    tickRedialsRef.current = tickRedials;
  }, [tickRedials]);

  /**
   * Retire slots whose calls have ended, so the pump can top the floor back up.
   * Force-releases any slot older than AI_SLOT_MAX_MS — otherwise a conversation
   * that never reaches a terminal state holds its line forever and the campaign
   * quietly stalls at N-1, which presents as "the dialer just stopped".
   *
   * Also the trigger point for the double-tap: a call that ended as a genuine
   * NO-ANSWER (and only that — never a real conversation, never a system failure)
   * gets one re-ring queued after the gap, holding the line it just freed.
   */
  const reapInflight = useCallback(async () => {
    const now = Date.now();
    for (const [id, at] of slotAgeRef.current) {
      if (now - at > AI_SLOT_MAX_MS) {
        inflightRef.current.delete(id);
        slotAgeRef.current.delete(id);
        if (id.startsWith("redial:")) redialsRef.current.delete(id.slice(7));
      }
    }
    const ids = [...inflightRef.current].filter(
      (id) => !id.startsWith("lead:") && !id.startsWith("redial:"),
    );
    if (!ids.length) return;
    try {
      const res = await fetch("/api/elevenlabs/inflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        active?: string[];
        ended?: { id: string; outcome: string | null }[];
      };
      const live = new Set(json.active ?? []);
      const endedOutcome = new Map(
        (json.ended ?? []).map((e) => [e.id, e.outcome] as const),
      );
      let scheduled = false;
      for (const id of ids) {
        if (live.has(id)) continue;
        inflightRef.current.delete(id);
        slotAgeRef.current.delete(id);
        const lead = convLeadRef.current.get(id);
        convLeadRef.current.delete(id);
        if (
          doubleDialRef.current &&
          endedOutcome.get(id) === "no_answer" &&
          lead &&
          (attemptsRef.current.get(lead.id) ?? 0) < 2 &&
          !redialsRef.current.has(lead.id)
        ) {
          // Hold the freed line for the re-ring instead of letting the pump race
          // ahead to a new lead — that's what makes the two calls land back to back.
          redialsRef.current.set(lead.id, {
            dueAt: now + doubleDialGapMsRef.current,
            lead,
          });
          inflightRef.current.add(`redial:${lead.id}`);
          slotAgeRef.current.set(`redial:${lead.id}`, now);
          scheduled = true;
        }
      }
      if (scheduled) tickRedialsRef.current();
    } catch {
      /* the age guard above is the backstop */
    }
  }, []);

  /**
   * The new-lead pump. Tops the floor up to `parallelCount` LIVE calls — no more.
   *
   * It asks how many lines are free and launches exactly that many (never N fresh
   * calls every tick regardless of whether the last ones ended — that throughput-
   * dial-wearing-a-concurrency-label is how a 10-line plan got flooded to ~70
   * simultaneous). Double-tap re-rings run on their OWN timer (tickRedials); their
   * held `redial:` reservations count toward the ceiling here, so the pump keeps a
   * line free for a re-ring instead of launching a new lead on top of it.
   */
  const launchAIBatch = useCallback(async () => {
    await reapInflight();
    const gen = sessionGenRef.current;
    const slots = Math.max(0, parallelRef.current - inflightRef.current.size);

    // Every line is busy (or held for a pending re-ring) — come back when one frees.
    if (slots === 0) {
      if (autoDialRef.current) {
        aiTimerRef.current = setTimeout(() => void launchAIBatch(), AI_PUMP_MS);
      }
      return;
    }

    const start = aiCursorRef.current;
    const leads = queue.slice(start, start + slots);
    if (!leads.length) {
      // Out of NEW leads — but don't declare "done" while calls are live OR a
      // double-tap is still owed.
      if (inflightRef.current.size > 0 || redialsRef.current.size > 0) {
        if (autoDialRef.current) {
          aiTimerRef.current = setTimeout(() => void launchAIBatch(), AI_PUMP_MS);
        }
        return;
      }
      stopAITimer();
      patch({ status: "ai", aiCampaign: "done" });
      return;
    }
    aiCursorRef.current = start + leads.length;
    queueIndexRef.current = Math.min(aiCursorRef.current, queue.length);
    patch({
      queueIndex: queueIndexRef.current,
      aiCampaign: autoDialRef.current ? "running" : "idle",
    });

    await Promise.all(leads.map((l) => launchAICall(l, gen)));

    // Keep pumping while auto-dial is on. The next tick re-checks free lines, so
    // this can't run away: if all N are still busy it launches nothing.
    if (autoDialRef.current && aiCursorRef.current < queue.length) {
      aiTimerRef.current = setTimeout(() => void launchAIBatch(), AI_PUMP_MS);
    } else if (aiCursorRef.current >= queue.length) {
      // End of this pass. Wait for calls on the wire AND any owed re-rings before
      // declaring the lap over — otherwise the parent refetches mid-flight and the
      // next lap stacks on top of live calls.
      if (
        (inflightRef.current.size > 0 || redialsRef.current.size > 0) &&
        autoDialRef.current
      ) {
        aiTimerRef.current = setTimeout(() => void launchAIBatch(), AI_PUMP_MS);
        return;
      }
      queueLapRef.current += 1;
      patch({ aiCampaign: "done", queueLap: queueLapRef.current });
    }
  }, [launchAICall, patch, queue, reapInflight, stopAITimer]);

  const startAISession = useCallback(() => {
    stopAITimer();
    sessionGenRef.current += 1;
    // Same stale-cursor trap as the manual path: a finished pass parks the
    // cursor at queue.length, and starting from there gives the pump nothing to
    // launch — the session would open and report "Campaign complete" on the spot.
    aiCursorRef.current = normalizeCursor();
    // A fresh session starts with every line free. Carrying stale slots over
    // would make the pump believe the floor was busy and launch nothing.
    inflightRef.current.clear();
    slotAgeRef.current.clear();
    purgeRedials();
    attemptsRef.current.clear();
    convLeadRef.current.clear();
    setState((s) => ({
      ...s,
      status: "ai",
      aiCalls: [],
      aiCampaign: autoDialRef.current ? "running" : "idle",
      error: null,
    }));
    void launchAIBatch();
  }, [launchAIBatch, normalizeCursor, purgeRedials, stopAITimer]);

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
          body: JSON.stringify({
            phone: e164,
            lead: known,
            agent: activeAgentRef.current,
            excludedCallerIds: excludedCallerIdsRef.current.length
              ? excludedCallerIdsRef.current
              : undefined,
          }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          conversationId?: string;
          error?: string;
          callerId?: string | null;
        };
        setState((s) => ({
          ...s,
          aiCalls: s.aiCalls.map((c) =>
            c.leadId === tempId
              ? {
                  ...c,
                  conversationId: json.conversationId ?? null,
                  error: res.ok ? undefined : json.error ?? "Call failed",
                  callerId: json.callerId ?? null,
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
      // Never fail silently here. This used to `return` with no state change and
      // no message, so pressing "Start session" looked like the dialer had
      // started and instantly quit — with nothing on screen explaining why.
      if (!leads.length) {
        patch({
          error: queue.length
            ? "Couldn't line up the next lead to dial. Reload your leads and try again."
            : "No leads are loaded — press “Load leads” to build a session first.",
          status: "idle",
          lines: [],
        });
        return;
      }

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
      // Count each LINE dialed, not each batch — a 3X parallel dial places three
      // calls and must read as three dials (AI mode already counts per lead), so
      // the session/day dial totals mean the same thing in both modes.
      recordDials(leads.length);
      setState((s) => ({
        ...s,
        callsThisSession: s.callsThisSession + leads.length,
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

      // Tracked outside the try so a failure to join the conference can still
      // hang up whatever we already put on the wire (see the catch below).
      let placedSids: string[] = [];

      try {
        // Dial the homeowner(s) into the conference room via Twilio REST.
        const res = await fetch("/api/twilio/call", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            room,
            agentIdentity: identityRef.current,
            leads: leads.map((l) => ({ leadId: l.id, phone: l.phone })),
            excludedCallerIds: excludedCallerIdsRef.current.length
              ? excludedCallerIdsRef.current
              : undefined,
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
        placedSids = outboundSids;
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
          // 120 polls × 1.5 s = 3 minutes max. Faster cadence flips the UI to
          // "live" within ~1.5 s of pickup (it was up to 2 s), tightening the gap
          // reps hit as "I'm on a call but it still says dialing." Treats a hung
          // Twilio response as no-answer so the rep isn't left waiting.
          if (++pollAttempts > 120) {
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
        pollRef.current = setInterval(pollAnswered, 1500);
      } catch {
        clearHumanPresence();
        // The homeowner leg(s) are already on the wire. If the rep's browser
        // couldn't join the conference — a blocked microphone is by far the most
        // common cause — hang them up instead of leaving real phones ringing an
        // empty room that nobody will ever speak into.
        releaseLegs(placedSids);
        patch({
          error:
            "Couldn't connect your side of the call. Check that this browser tab is allowed to use your microphone, then try again.",
          status: "idle",
          lines: [],
        });
        resetToIdle();
      }
    },
    [
      attachCallHandlers,
      clearHumanPresence,
      connectLine,
      nextLeads,
      patch,
      queue.length,
      recordDials,
      releaseLegs,
      resetToIdle,
      stopPoll,
    ],
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
    purgeRedials();
    attemptsRef.current.clear();
    convLeadRef.current.clear();
    patch({ status: "idle", aiCalls: [], aiCampaign: "idle" });
  }, [patch, purgeRedials, stopAITimer]);

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

  /**
   * The ceiling is MODE-AWARE. A human rep genuinely can't handle more than a few
   * ringing lines — every extra answered call gets abandoned, which is rude and a
   * compliance problem. The AI agent has no such limit; its ceiling is whatever
   * the voice plan allows. Collapsing both into one hardcoded `Math.min(3, …)`
   * meant a 10-concurrent plan ran at 30% of what it pays for.
   */
  const maxParallel = useCallback(
    () =>
      aiModeRef.current
        ? Math.max(1, Math.min(MAX_PARALLEL_AI, maxAiRef.current))
        : MAX_PARALLEL_HUMAN,
    [],
  );

  const setParallelCount = useCallback(
    (value: number) => {
      const clamped = Math.min(maxParallel(), Math.max(1, value));
      parallelRef.current = clamped;
      patch({ parallelCount: clamped, maxParallel: maxParallel() });
    },
    [maxParallel, patch],
  );

  const setAiMode = useCallback(
    (value: boolean) => {
      // AI can only be turned ON when it's actually usable for this viewer
      // (configured + permitted); otherwise the dialer stays in manual mode.
      const next = value && aiConfiguredRef.current;
      aiModeRef.current = next;
      stopAITimer();
      clearHumanPresence();
      inflightRef.current.clear();
      slotAgeRef.current.clear();
      purgeRedials();
      attemptsRef.current.clear();
      convLeadRef.current.clear();

      // Re-clamp: the ceilings differ per mode. Switching AI(10x) -> human without
      // this would leave one rep with ten lines ringing, and nine of those
      // homeowners would answer to nobody.
      const ceiling = next
        ? Math.max(1, Math.min(MAX_PARALLEL_AI, maxAiRef.current))
        : MAX_PARALLEL_HUMAN;
      parallelRef.current = Math.min(parallelRef.current, ceiling);

      patch({
        aiMode: next,
        status: "idle",
        aiCalls: [],
        aiCampaign: "idle",
        parallelCount: parallelRef.current,
        maxParallel: ceiling,
      });
    },
    [clearHumanPresence, patch, stopAITimer],
  );

  /** Pick which AI persona AI calls dial as. Mirrored to a ref so in-flight
   *  launches read the current value. */
  const setActiveAgent = useCallback(
    (value: AgentKey) => {
      activeAgentRef.current = value;
      patch({ activeAgent: value });
    },
    [patch],
  );

  /** Flip a caller ID's excluded/included state from the dialer's toggle row.
   *  Mirrored to a ref so in-flight/async call launches read the current
   *  value, and to localStorage so the choice survives reloads. The picker UI
   *  is responsible for not letting the rep exclude every number — this just
   *  flips membership. */
  const toggleExcludedCallerId = useCallback(
    (callerId: string) => {
      const cur = excludedCallerIdsRef.current;
      const next = cur.includes(callerId)
        ? cur.filter((n) => n !== callerId)
        : [...cur, callerId];
      excludedCallerIdsRef.current = next;
      writeExcludedCallerIds(userIdRef.current, next);
      patch({ excludedCallerIds: next });
    },
    [patch],
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
    setActiveAgent,
    toggleExcludedCallerId,
    launchNextAI,
    stopAICampaign,
    endAISession,
    nextLead,
    prevLead,
    selectLead,
    reconnect,
  };
}
