"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { mergeClaimedLeads } from "@/lib/dialer/claims";
import {
  DEFAULT_SESSION_META,
  type DialSessionMeta,
} from "@/lib/dialer/segments";
import type { DialerSessionPrefs, DialerUserPrefs } from "@/lib/dialer/user-prefs";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import type { AiLockReason, DialerLayout } from "@/lib/org/settings";
import { useOrgChannel } from "@/lib/realtime/use-org-channel";
import type { Lead, LeadGroup } from "@/lib/types";
import {
  MAX_PARALLEL_HUMAN,
  useDialer,
  type DialerEngineOptions,
} from "@/lib/use-dialer";

/** "all" = no filter, "unsorted" = leadGroup is null, else an exact LeadGroup. */
export type GroupFilter = "all" | "unsorted" | LeadGroup;

// ─────────────────────────────────────────────────────────────────────────────
// App-wide dialer provider. Holds the ONE dialer engine (Twilio device + call
// state machine) above the page, mounted in AppShell — so a live call survives
// navigating between sections instead of being torn down when the dialer page
// unmounts. The device is lazily initialized: nothing happens (no mic prompt,
// no token fetch) until the dialer page calls activate() the first time; after
// that it stays active for the rest of the session.
// ─────────────────────────────────────────────────────────────────────────────

export interface DialerConfig {
  userId?: string;
  /** The viewer's display name — what the dialer tracks as channel presence
   *  so the floor roster shows a human, not a uuid. */
  displayName?: string;
  /** The viewer's active org — names the private realtime floor channel the
   *  dialer subscribes to (answered fast-path). Null/absent = demo, no channel. */
  orgId?: string | null;
  /** Org policy `settings.dialing.recording` — what the rep leg passes to the
   *  conference record flag, and what the RecordingIndicator reports. */
  recordingEnabled?: boolean;
  /** Lease-based dial reservations (`settings.dialing.reservations`), already
   *  gated server-side on a configured database — false = legacy local queue. */
  reservationsEnabled?: boolean;
  voiceConfigured: boolean;
  aiAgentConfigured: boolean;
  /** A distinct second AI agent is configured — reveals the dialer's agent picker. */
  secondAgentConfigured?: boolean;
  /** Display labels for the two AI agents in the picker. */
  agentNames?: { primary: string; secondary: string };
  manualEnabled: boolean;
  aiEnabled: boolean;
  aiLockReason: AiLockReason;
  /** "org" for supervisors (dial the whole org pool), "own" for reps. Drives
   *  the dialer's queue label — the actual scope is enforced server-side. */
  dialScope: "org" | "own";
  /** The org's AI concurrency allowance (their voice plan's live-call limit). */
  maxAiConcurrency?: number;
  /** The org's ceiling on simultaneous human lines (Admin → Dialing → Max lines).
   *  1 means no parallel dialing at all for this workspace. */
  maxHumanLines?: number;
  /** The effective caller-ID rotation pool — powers the dialer's caller-ID picker. */
  callerIdPool?: string[];
  /** Rotation cadence for the pool above (calls per number before advancing). */
  callerIdRotateEvery?: number;
  /** AI double-dial: re-ring a no-answer once after `doubleDialGapSec` before moving on. */
  doubleDial?: boolean;
  doubleDialGapSec?: number;
  /** Which mode the dialer boots into (`settings.dialing.defaultMode`). "ai"
   *  falls back to manual for viewers who can't use the AI dialer; "parallel"
   *  falls back when the org's line ceiling is 1. */
  defaultDialMode?: "manual" | "parallel" | "ai";
  /** `settings.hours` — drives the dialer's outside-hours banner. When
   *  `enforced`, the call routes also refuse dials server-side. */
  callingHours?: { startHour: number; endHour: number; days: number[]; enforced?: boolean } | null;
  /** The org's IANA timezone — the banner evaluates the hours in it. */
  orgTimezone?: string;
  /** The viewer's own dialer prefs (profile preferences.dialerPrefs). */
  userPrefs?: DialerUserPrefs;
  /** The session builder's remembered choices (profile preferences.dialerSession). */
  savedSession?: DialerSessionPrefs | null;
  /** Show the "Solar payment" field in the qualification panel (per-tenant). */
  qualifyShowSolarPayment?: boolean;
  /** Label for the third home-profile toggle in the qualification panel. */
  qualifyOtherLabel?: string;
  /** Effective dialer-page layout (default ⊕ template preset ⊕ org toggles). */
  dialerLayout?: DialerLayout;
  /** The org's resolved lead field schema — drives the lead panel's stat
   *  tiles, flag chips and the lead-browser search haystack. */
  leadFields?: LeadFieldDef[];
  /** The fields the qualify panel renders, in order (already resolved and
   *  filtered server-side — solar slots never reach a non-solar tenant). */
  qualifyFields?: LeadFieldDef[];
  /** Legacy per-org display-label overrides (still honored on top of labels). */
  leadGroupLabels?: Record<string, string>;
  /** The org's own intake groups, in display order — drives the group filter. */
  leadGroups?: { key: string; label: string }[];
  /** The viewer's effective permissions. The dialer gates a couple of
   *  supervisor-only affordances on these (reverse search); every one of them
   *  is re-checked server-side, so this only decides what's DRAWN. */
  permissions?: string[];
  /** True when an automated skip-trace provider is set. False ⇒ the reverse-
   *  search button uses zero-config manual mode (open Whitepages in a tab). */
  reverseSearchConfigured?: boolean;
}

/** What the dialer knows about a campaign — enough to filter the queue and
 *  show the assigned call script ("" / absent = no script). */
export type DialerCampaign = {
  id: string;
  name: string;
  scriptA?: string;
  scriptB?: string;
  /** The campaign's wrap-up subset (`disposition_keys`). Empty/absent = every
   *  enabled disposition; non-empty narrows the OutcomeGrid to these keys. */
  dispositionKeys?: string[];
  /** The campaign's stated goal — the AI session header shows it so the
   *  operator can see WHAT the agent is trying to achieve. "" = none set. */
  objective?: string;
};

type Campaign = DialerCampaign;

interface DialerContextValue {
  dialer: ReturnType<typeof useDialer>;
  config: DialerConfig;
  queue: Lead[];
  queueForDialer: Lead[];
  campaignFilter: string;
  setCampaignFilter: (id: string) => void;
  /** Which lead-intake group ("dropbox") to dial — set from the load-leads picker. */
  groupFilter: GroupFilter;
  setGroupFilter: (g: GroupFilter) => void;
  /** Narrow the queue to leads this viewer personally uploaded. Meaningful for
   *  supervisors only — reps are already own-scoped server-side. */
  myLeadsOnly: boolean;
  setMyLeadsOnly: (v: boolean) => void;
  campaigns: Campaign[];
  /** Merge a patch into one queued lead in place, so an edit made from inside
   *  the dialer (e.g. a reverse-searched phone number) shows on the card
   *  immediately. Deliberately NOT a refetch: loadLeads() rebuilds the whole
   *  queue and resets the position a rep is working through. The server write
   *  is the caller's job — this only moves the client's copy into step. */
  applyLeadPatch: (leadId: string, patch: Partial<Lead>) => void;
  loadLeads: () => Promise<Lead[]>;
  /** Scope every queue fetch to ONE assignment (?assignment= on the queue
   *  API — server-verified). null clears the scope. Takes effect on the next
   *  loadLeads(); stored in a ref so mid-session refetches (auto-dial laps)
   *  keep the scope without re-rendering the provider. */
  setAssignmentScope: (id: string | null) => void;
  loadingLeads: boolean;
  loadMsg: string | null;
  /** Seed initial data + turn the engine on. Called by the dialer page on mount. */
  activate: (initialQueue?: Lead[], campaigns?: Campaign[], initialCampaign?: string) => void;
  activated: boolean;
  /**
   * Replace the queue with an explicitly-built session (SessionBuilder). The
   * meta rides into every claim: its statuses gate eligibility, strictOrder
   * keeps claims inside this exact list, refill opts into loud pool top-ups.
   */
  loadSession: (leads: Lead[], meta: DialSessionMeta) => void;
  /** The active session's meta — what the queue panel displays. */
  sessionMeta: DialSessionMeta;
}

const Ctx = createContext<DialerContextValue | null>(null);

export function useDialerContext(): DialerContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDialerContext must be used within a DialerProvider");
  return v;
}

/** Optional variant — null when there's no provider (e.g. non-app routes). */
export function useDialerContextOptional(): DialerContextValue | null {
  return useContext(Ctx);
}

export function DialerProvider({
  config,
  children,
}: {
  config: DialerConfig;
  children: React.ReactNode;
}) {
  const [activated, setActivated] = useState(false);
  const [queue, setQueue] = useState<Lead[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignFilter, setCampaignFilter] = useState("");
  const [groupFilter, setGroupFilter] = useState<GroupFilter>("all");
  const [myLeadsOnly, setMyLeadsOnly] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  // Remember the "My leads" choice per user across sessions, so a rep-manager who
  // wants to dial only their own leads doesn't have to re-toggle it every visit.
  // Loaded after mount (not in the initializer) to avoid a hydration mismatch.
  const myLeadsKey = config.userId ? `aj:myLeadsOnly:${config.userId}` : null;
  useEffect(() => {
    if (!myLeadsKey) return;
    try {
      const saved = window.localStorage.getItem(myLeadsKey);
      if (saved != null) setMyLeadsOnly(saved === "1");
    } catch {
      /* storage disabled — the toggle just won't persist */
    }
  }, [myLeadsKey]);
  const setMyLeadsOnlyPersisted = (v: boolean) => {
    setMyLeadsOnly(v);
    if (myLeadsKey) {
      try {
        window.localStorage.setItem(myLeadsKey, v ? "1" : "0");
      } catch {
        /* noop */
      }
    }
  };
  const [loadMsg, setLoadMsg] = useState<string | null>(null);

  const aiUsable = config.aiAgentConfigured && config.aiEnabled;
  // Shared by queueForDialer and the auto-dial lap-refetch effect below, so the
  // two never drift apart. The `config.userId &&` guard matters: without an
  // identity (demo mode, signed-out edge cases) `myLeadsOnly` must be a no-op
  // rather than hiding every lead just because `undefined === undefined`.
  const matchesFilters = (l: Lead) => {
    if (campaignFilter && l.campaignId !== campaignFilter) return false;
    if (groupFilter === "unsorted" && l.leadGroup) return false;
    if (groupFilter !== "all" && groupFilter !== "unsorted" && l.leadGroup !== groupFilter)
      return false;
    // "My leads" = uploaded by me OR assigned to me (assigned_rep_id) — the same
    // scope the server enforces for reps. The `config.userId &&` guard keeps this
    // a no-op without an identity (demo / signed-out) instead of hiding every
    // lead just because `undefined === undefined`.
    if (
      myLeadsOnly &&
      config.userId &&
      l.ownerId !== config.userId &&
      l.assignedRepId !== config.userId
    )
      return false;
    return true;
  };
  const queueForDialer = queue.filter(matchesFilters);

  // The active dial session's claim behavior. A ref (claims read it at dial
  // time from an effect closure) mirrored into state for display. Defaults:
  // STRICT — even a plain "Load leads" queue may only be claimed from itself,
  // never silently swapped for the org pool.
  const sessionMetaRef = useRef<DialSessionMeta>({ ...DEFAULT_SESSION_META });
  const [sessionMeta, setSessionMeta] = useState<DialSessionMeta>({
    ...DEFAULT_SESSION_META,
  });
  const applySessionMeta = useCallback((meta: DialSessionMeta) => {
    sessionMetaRef.current = meta;
    setSessionMeta(meta);
  }, []);

  // Assignment scope for queue fetches — a ref, not state: auto-dial's lap
  // refetch runs from an effect closure and must always see the CURRENT scope.
  // Declared BEFORE the engine so the claim context below can read it lazily.
  const assignmentRef = useRef<string | null>(null);
  const setAssignmentScope = useCallback((id: string | null) => {
    assignmentRef.current = id;
  }, []);
  // Campaign filter mirror for the same reason — claims read it at dial time.
  const campaignFilterRef = useRef(campaignFilter);
  campaignFilterRef.current = campaignFilter;

  // Claimed leads may not be in the locally-loaded queue (another page of the
  // book, a fresher server view) — merge them in so the UI shows what's
  // actually being dialed. The queue PANEL renders this same display queue.
  const onClaimed = useCallback((claimed: Lead[]) => {
    setQueue((q) => mergeClaimedLeads(q, claimed));
  }, []);

  // The engine dropped phone-duplicate lanes before dialing (lane-dedupe.ts) —
  // say so out loud (a lane the rep queued that silently never rings reads as
  // "the dialer skipped my lead") and count it server-side for trend data.
  const { toast } = useToast();
  const onDuplicateLanesDropped = useCallback(
    (dropped: Lead[]) => {
      const names = dropped
        .map((l) => `${l.firstName} ${l.lastName}`.trim() || l.phone)
        .join(", ");
      toast({
        title:
          dropped.length === 1
            ? "Duplicate number skipped"
            : `${dropped.length} duplicate numbers skipped`,
        description: `${names} share${dropped.length === 1 ? "s" : ""} a phone number with another line in this round — the number is only being dialed once.`,
      });
      fetch("/api/telemetry", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metric: "lane.dup_dropped", value: dropped.length }),
        keepalive: true,
      }).catch(() => {});
    },
    [toast],
  );

  const engineOptions = useMemo<DialerEngineOptions>(
    () => ({
      recordingEnabled: config.recordingEnabled ?? true,
      // The org's chosen boot mode. The engine resolves fallbacks itself (AI
      // unusable → manual; parallel with a 1-line ceiling → manual).
      initialMode: config.defaultDialMode ?? "ai",
      userPrefs: config.userPrefs,
      reservations: {
        enabled: Boolean(config.reservationsEnabled),
        // Lazy: read at dial time so mid-session filter changes are honored.
        // The session meta carries the builder's statuses + the queue-fidelity
        // contract (strictOrder/refill) into every claim.
        getContext: () => ({
          campaignId: campaignFilterRef.current || undefined,
          packId: assignmentRef.current || undefined,
          statuses: sessionMetaRef.current.statuses,
          strictOrder: sessionMetaRef.current.strictOrder,
          refill: sessionMetaRef.current.refill,
        }),
        onClaimed,
        onQueueRefilled: (leads) => {
          toast({
            title: "List finished — refilled from your pool",
            description: `Your loaded session is done, so auto-refill pulled ${leads.length} eligible lead${leads.length === 1 ? "" : "s"} to keep you dialing. Turn refill off in the session builder to stop at the end of a list.`,
          });
        },
      },
      onDuplicateLanesDropped,
    }),
    [
      config.recordingEnabled,
      config.reservationsEnabled,
      config.defaultDialMode,
      config.userPrefs,
      onClaimed,
      onDuplicateLanesDropped,
      toast,
    ],
  );

  const dialer = useDialer(
    queueForDialer,
    aiUsable,
    config.userId,
    activated,
    config.maxAiConcurrency ?? 10,
    config.doubleDial ?? false,
    config.doubleDialGapSec ?? 15,
    config.maxHumanLines ?? MAX_PARALLEL_HUMAN,
    engineOptions,
  );
  const { state } = dialer;

  // ── Org floor channel: the answered fast-path ──────────────────────────────
  // One shared socket per org (the monitors/roster ride the same one). When the
  // server broadcasts `call.answered` for OUR conference room, run the dialer's
  // existing answered-resolution immediately instead of waiting out its poll —
  // pickup→"connected" drops from worst-case 1.5–5s to ~broadcast latency. The
  // handler lives in a ref inside useOrgChannel, so reading `state.room` here
  // always sees the current attempt. Everything else (health) just tells the
  // engine it may relax the poll; demo mode reports "unavailable" and the
  // dialer keeps its 1.5s poll exactly as before.
  const { health: floorHealth } = useOrgChannel({
    orgId: config.orgId ?? null,
    on: {
      "call.answered": (p) => {
        if (p.room && p.room === state.room) dialer.onAnsweredHint(p.answeredLeadId);
      },
    },
  });
  const { setRealtimeLive } = dialer;
  useEffect(() => {
    setRealtimeLive(floorHealth === "live");
  }, [floorHealth, setRealtimeLive]);

  const applyLeadPatch = useCallback((leadId: string, patch: Partial<Lead>) => {
    setQueue((q) => q.map((l) => (l.id === leadId ? { ...l, ...patch } : l)));
  }, []);

  /** SessionBuilder hand-off: the queue becomes exactly this list, and the
   *  meta governs every claim until the next load. Also remembers the
   *  builder's choices on the profile so the next visit starts from them. */
  // A plain function on purpose (like loadLeads): it closes over the CURRENT
  // dialer + filter setters, and nothing depends on its identity.
  function loadSession(leads: Lead[], meta: DialSessionMeta) {
    {
      setQueue(leads);
      applySessionMeta(meta);
      // A fresh session starts at the TOP of its list and with a clean slate
      // of client filters — a lingering campaign/group/my-leads filter from
      // the toolbar would silently AND against the built list (hiding it, or
      // instantly "finishing" it at claim time), and a mid-list cursor from
      // the previous session breaks the builder's "in this order" promise.
      dialer.resetQueueCursor();
      setCampaignFilter("");
      setGroupFilter("all");
      setMyLeadsOnlyPersisted(false);
      setLoadMsg(
        meta.summary ??
          `Loaded ${leads.length} lead${leads.length === 1 ? "" : "s"} into the dialer.`,
      );
      fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          preferences: {
            dialerSession: {
              statuses: meta.statuses,
              strictOrder: meta.strictOrder,
              refill: meta.refill,
            },
          },
        }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  async function loadLeads(): Promise<Lead[]> {
    setLoadingLeads(true);
    setLoadMsg(null);
    try {
      const scoped = assignmentRef.current
        ? `?assignment=${encodeURIComponent(assignmentRef.current)}`
        : "";
      const res = await fetch(`/api/leads/queue${scoped}`, { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        leads?: Lead[];
        // Null when the book could not be counted — see getMyLeadsCount.
        total?: number | null;
        error?: string;
      };

      // NEVER wipe an already-loaded queue because a refetch failed. res.ok was
      // unchecked and a non-array `leads` collapsed to [], so any hiccup — an
      // expired session, a 500, a truncated body — ran setQueue([]) and every
      // lead vanished from the dialer the instant the rep pressed the button.
      // A failed reload has to leave what's on screen exactly as it was.
      if (!res.ok || !Array.isArray(json.leads)) {
        setLoadMsg(
          json.error ??
            "Couldn’t reload your leads just now — your list is unchanged. Try again in a moment.",
        );
        return [];
      }

      const leads = json.leads;
      setQueue(leads);
      // A plain load is the DEFAULT session: standard segments, strict order,
      // no refill — a stale builder meta must not govern a fresh queue.
      applySessionMeta({ ...DEFAULT_SESSION_META });
      // total counts EVERY lead in scope, leads.length only the dialable subset
      // (dialable status + a 10+ digit phone). Silently loading fewer than the
      // rep's book size — with no explanation — read as "some leads vanished."
      //
      // A NULL total means the count failed. Folding that to 0 sent a rep with
      // a full book the message "No leads found — import a CSV on the Leads tab
      // first", which is both false and an instruction to do the one thing that
      // would make it worse.
      const total = typeof json.total === "number" ? json.total : null;
      const skipped = total === null ? 0 : Math.max(0, total - leads.length);
      if (leads.length) {
        setLoadMsg(
          skipped > 0
            ? `Loaded ${leads.length} of ${total} leads into the dialer — ${skipped} skipped (no valid phone number, already dispositioned, or on the do-not-call list).`
            : `Loaded ${leads.length} lead${leads.length === 1 ? "" : "s"} into the dialer.`,
        );
      } else if (total === null) {
        setLoadMsg(
          "Nothing is ready to dial right now, and we couldn’t check how many leads are in your book. Try again in a moment.",
        );
      } else if (total > 0) {
        setLoadMsg(
          `Found ${total} leads, but none are ready to dial yet — they need a New / No-answer / Callback status and a valid phone number.`,
        );
      } else {
        setLoadMsg("No leads found — import a CSV on the Leads tab first.");
      }
      return leads;
    } catch {
      setLoadMsg("Couldn’t load leads. Check your connection and try again.");
      return [];
    } finally {
      setLoadingLeads(false);
    }
  }

  function activate(initialQueue?: Lead[], initialCampaigns?: Campaign[], initialCampaign?: string) {
    if (initialQueue && initialQueue.length && queue.length === 0) setQueue(initialQueue);
    // Campaigns REFRESH on every activation (each /dialer visit ships a fresh
    // server-rendered list) — unlike the queue, replacing them can't disturb a
    // live call, and holding the first visit's copy froze script A/B edits out
    // of long-lived sessions: a rep kept reading (and attributing) script A for
    // leads assigned to a B variant launched after their session began.
    if (initialCampaigns && initialCampaigns.length) setCampaigns(initialCampaigns);
    if (
      initialCampaign &&
      !campaignFilter &&
      (initialCampaigns ?? campaigns).some((c) => c.id === initialCampaign)
    )
      setCampaignFilter(initialCampaign);
    setActivated(true);
  }

  // Auto-dial "repeat the whole list": when a full pass completes (queueLap
  // increments), refetch the dial queue before the next pass so leads just
  // dispositioned drop out. Lives here (not the page) so it keeps running while
  // the rep is on another section. Mirrors the original page-level watcher.
  const lastHandledLapRef = useRef(0);
  useEffect(() => {
    if (!state.autoDial) return;
    if (state.queueLap === lastHandledLapRef.current) return;
    lastHandledLapRef.current = state.queueLap;

    let cancelled = false;
    (async () => {
      await new Promise((r) => setTimeout(r, 2500));
      if (cancelled) return;
      // A BUILDER session at lap end honors its own contract — the lap
      // refetch used to call loadLeads() here unconditionally, which swapped
      // the built list for the default pool queue and reset the meta: the
      // exact "silent swap into off-list dialing" the fidelity patch forbids,
      // resurrected through auto-dial. (Caught by review.)
      const meta = sessionMetaRef.current;
      if (meta.summary != null && !meta.refill) {
        dialer.setAutoDial(false);
        setLoadMsg(
          "Auto-dial finished — your session's list is done. Load a new session to keep going (or turn on Auto-refill in the builder).",
        );
        return;
      }
      const swappingFromSession = meta.summary != null;
      const fresh = await loadLeads();
      if (cancelled) return;
      const stillDialable = fresh.filter(matchesFilters);
      if (stillDialable.length > 0) {
        if (swappingFromSession) {
          // Refill was opted in: the swap to the default pool is allowed,
          // but never silent.
          setLoadMsg(
            `Session finished — auto-refill loaded ${stillDialable.length} leads from your default queue and auto-dial continues.`,
          );
        }
        dialer.restartAutoDialLap();
      } else {
        dialer.setAutoDial(false);
        setLoadMsg("Auto-dial finished — every lead in your list has been dialed.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.queueLap, state.autoDial]);

  const value: DialerContextValue = {
    dialer,
    config,
    queue,
    queueForDialer,
    campaignFilter,
    setCampaignFilter,
    groupFilter,
    setGroupFilter,
    myLeadsOnly,
    setMyLeadsOnly: setMyLeadsOnlyPersisted,
    campaigns,
    applyLeadPatch,
    loadLeads,
    setAssignmentScope,
    loadingLeads,
    loadMsg,
    activate,
    activated,
    loadSession,
    sessionMeta,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
