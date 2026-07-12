"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { AiLockReason } from "@/lib/org/settings";
import type { Lead } from "@/lib/types";
import { useDialer } from "@/lib/use-dialer";

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
  manualEnabled: boolean;
  aiEnabled: boolean;
  aiLockReason: AiLockReason;
  /** "org" for supervisors (dial the whole org pool), "own" for reps. Drives
   *  the dialer's queue label — the actual scope is enforced server-side. */
  dialScope: "org" | "own";
  /** The org's AI concurrency allowance (their voice plan's live-call limit). */
  maxAiConcurrency?: number;
}

type Campaign = { id: string; name: string };

interface DialerContextValue {
  dialer: ReturnType<typeof useDialer>;
  config: DialerConfig;
  queue: Lead[];
  queueForDialer: Lead[];
  campaignFilter: string;
  setCampaignFilter: (id: string) => void;
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
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);

  const aiUsable = config.aiAgentConfigured && config.aiEnabled;
  const queueForDialer = campaignFilter
    ? queue.filter((l) => l.campaignId === campaignFilter)
    : queue;

  const dialer = useDialer(
    queueForDialer,
    aiUsable,
    config.userId,
    activated,
    config.maxAiConcurrency ?? 10,
  );
  const { state } = dialer;

  async function loadLeads(): Promise<Lead[]> {
    setLoadingLeads(true);
    setLoadMsg(null);
    try {
      const res = await fetch("/api/leads/queue", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as { leads?: Lead[]; total?: number };
      const leads = Array.isArray(json.leads) ? json.leads : [];
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
      const stillDialable = campaignFilter
        ? fresh.filter((l) => l.campaignId === campaignFilter)
        : fresh;
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
    campaigns,
    loadLeads,
    loadingLeads,
    loadMsg,
    activate,
    activated,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
