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
      // Counted in SQL. This used to fetch the call rows with `.limit(20000)`
      // and no `.range()` — and a limit above the PostgREST response ceiling is
      // not a limit, the response is truncated at the ceiling. The rows are
      // ordered started_at DESC, so what truncation dropped was THIS MORNING.
      // Measured: the busiest day here is 2,678 calls, well past the ceiling.
      admin.rpc("app_floor_calls_by_day", {
        p_org: orgId,
        p_since: since,
        p_tz: timezone,
      }),
    ]);
    if (membersRes.error)
      console.error("[floor] members query failed:", membersRes.error.message);
    if (callsRes.error)
      console.error("[floor] call_records query failed:", callsRes.error.message);

    const nameById = new Map(
      ((membersRes.data ?? []) as Row[]).map((m) => [String(m.user_id), String(m.name ?? "")]),
    );

    // Calls today per rep. The day key is computed by the RPC with `at time
    // zone`, which is the same calendar-day rule zonedDayKey applies here — the
    // 26-hour window it reads over straddles two of them.
    const callsByOwner = new Map<string, number>();
    for (const c of (callsRes.data ?? []) as Row[]) {
      if (!c.owner_id || String(c.day_key ?? "") !== todayKey) continue;
      const k = String(c.owner_id);
      callsByOwner.set(k, (callsByOwner.get(k) ?? 0) + Number(c.n ?? 0));
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
