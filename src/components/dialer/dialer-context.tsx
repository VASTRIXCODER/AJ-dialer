"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AiLockReason } from "@/lib/org/settings";
import type { Lead, LeadGroup } from "@/lib/types";
import { useDialer } from "@/lib/use-dialer";

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
  /** The effective caller-ID rotation pool — powers the dialer's caller-ID picker. */
  callerIdPool?: string[];
  /** Rotation cadence for the pool above (calls per number before advancing). */
  callerIdRotateEvery?: number;
  /** AI double-dial: re-ring a no-answer once after `doubleDialGapSec` before moving on. */
  doubleDial?: boolean;
  doubleDialGapSec?: number;
  /** Show the "Solar payment" field in the qualification panel (per-tenant). */
  qualifyShowSolarPayment?: boolean;
  /** Label for the third home-profile toggle in the qualification panel. */
  qualifyOtherLabel?: string;
  /** Per-org display-label overrides for the lead-group "dropboxes" (display only). */
  leadGroupLabels?: Record<string, string>;
}

type Campaign = { id: string; name: string };

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
  loadLeads: () => Promise<Lead[]>;
  loadingLeads: boolean;
  loadMsg: string | null;
  /** Seed initial data + turn the engine on. Called by the dialer page on mount. */
  activate: (initialQueue?: Lead[], campaigns?: Campaign[], initialCampaign?: string) => void;
  activated: boolean;
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

  const dialer = useDialer(
    queueForDialer,
    aiUsable,
    config.userId,
    activated,
    config.maxAiConcurrency ?? 10,
    config.doubleDial ?? false,
    config.doubleDialGapSec ?? 15,
  );
  const { state } = dialer;

  async function loadLeads(): Promise<Lead[]> {
    setLoadingLeads(true);
    setLoadMsg(null);
    try {
      const res = await fetch("/api/leads/queue", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        leads?: Lead[];
        total?: number;
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
      if (leads.length) {
        setLoadMsg(`Loaded ${leads.length} lead${leads.length === 1 ? "" : "s"} into the dialer.`);
      } else if ((json.total ?? 0) > 0) {
        setLoadMsg(
          `Found ${json.total} leads, but none are ready to dial yet — they need a New / No-answer / Callback status and a valid phone number.`,
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
    if (initialCampaigns && initialCampaigns.length && campaigns.length === 0)
      setCampaigns(initialCampaigns);
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
      const fresh = await loadLeads();
      if (cancelled) return;
      const stillDialable = fresh.filter(matchesFilters);
      if (stillDialable.length > 0) {
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
    loadLeads,
    loadingLeads,
    loadMsg,
    activate,
    activated,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
