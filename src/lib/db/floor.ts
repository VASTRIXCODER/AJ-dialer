import "server-only";

import { zonedDayKey } from "../dialer/schedule";
import {
  type HumanCallState,
  listActiveHumanCallsForOrg,
} from "../human-call-store";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// "Live floor" snapshot for the power dialer — who on the team is dialing right
// now, and how many calls each has made today. Shared across every org member so
// the whole floor can see activity, not just supervisors in the Live Monitor.
//
// Counts come from call_records (the same shared source the leaderboard/reports
// use), NOT the per-device localStorage "dials today" counter — so the number is
// consistent for everyone and doesn't reset when someone refreshes. "Live now"
// state comes from the human-call presence store (live_calls table).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

export interface FloorDialer {
  id: string;
  name: string;
  /** Calls logged today (this org's local day), from call_records. */
  callsToday: number;
  /** Present when the rep is on a live manual call right now. */
  live: { state: HumanCallState; leadName: string } | null;
}

export interface DialerFloorSnapshot {
  dialers: FloorDialer[];
  /** Org-wide calls logged today. */
  totalCallsToday: number;
  /** How many reps are on a live call this instant. */
  activeCount: number;
}

const EMPTY: DialerFloorSnapshot = { dialers: [], totalCallsToday: 0, activeCount: 0 };

export async function getDialerFloor(
  orgId: string | null,
  timezone: string,
): Promise<DialerFloorSnapshot> {
  if (!orgId || !isAdminConfigured()) return EMPTY;
  try {
    const admin = createAdminClient();
    const todayKey = zonedDayKey(new Date(), timezone);
    // Fetch a window wide enough to cover the org's local "today" from any
    // timezone, then filter precisely by local day-key below.
    const since = new Date(Date.now() - 26 * 3_600_000).toISOString();

    const [active, membersRes, callsRes] = await Promise.all([
      listActiveHumanCallsForOrg(orgId),
      admin
        .from("organization_members")
        .select("user_id,name")
        .eq("org_id", orgId)
        .eq("status", "active"),
      admin
        .from("call_records")
        .select("owner_id,started_at")
        .eq("org_id", orgId)
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(20000),
    ]);
    if (membersRes.error)
      console.error("[floor] members query failed:", membersRes.error.message);
    if (callsRes.error)
      console.error("[floor] call_records query failed:", callsRes.error.message);

    const nameById = new Map(
      ((membersRes.data ?? []) as Row[]).map((m) => [String(m.user_id), String(m.name ?? "")]),
    );

    // Calls today per rep — timezone-aware so the org's calendar day is honored.
    const callsByOwner = new Map<string, number>();
    for (const c of (callsRes.data ?? []) as Row[]) {
      if (!c.started_at || !c.owner_id) continue;
      if (zonedDayKey(new Date(String(c.started_at)), timezone) !== todayKey) continue;
      const k = String(c.owner_id);
      callsByOwner.set(k, (callsByOwner.get(k) ?? 0) + 1);
    }

    // First (most recent) live call per rep.
    const liveByOwner = new Map<
      string,
      { state: HumanCallState; leadName: string }
    >();
    for (const a of active) {
      if (!a.ownerId || liveByOwner.has(a.ownerId)) continue;
      liveByOwner.set(a.ownerId, { state: a.state, leadName: a.leadName });
    }

    // Roster = everyone who has dialed today OR is live now.
    const ids = new Set<string>([...callsByOwner.keys(), ...liveByOwner.keys()]);
    const dialers: FloorDialer[] = [...ids]
      .map((id) => ({
        id,
        name: nameById.get(id) || "Teammate",
        callsToday: callsByOwner.get(id) ?? 0,
        live: liveByOwner.get(id) ?? null,
      }))
      // Live reps first, then by volume.
      .sort((a, b) => Number(Boolean(b.live)) - Number(Boolean(a.live)) || b.callsToday - a.callsToday);

    const totalCallsToday = [...callsByOwner.values()].reduce((a, b) => a + b, 0);
    return { dialers, totalCallsToday, activeCount: liveByOwner.size };
  } catch (e) {
    console.error("[floor] getDialerFloor failed:", e instanceof Error ? e.message : e);
    return EMPTY;
  }
}
