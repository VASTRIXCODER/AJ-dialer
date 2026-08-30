import "server-only";

import { reconcileActiveCalls, reconcileViaTwilio } from "@/lib/ai-call-reconcile";
import { type AICall, listActiveAICalls } from "@/lib/ai-call-store";
import { getAIConversationsForMonitor } from "@/lib/db/records";
import { zonedDayKey } from "@/lib/dialer/schedule";
import type { SnapshotAiCall } from "@/lib/realtime/floor-reducer";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { count } from "@/lib/telemetry";
import { isTerminalLiveState, liveStateRank } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Floor snapshot data assembly — the server side of /api/floor/snapshot.
//
// The AI active set REUSES the /api/elevenlabs/conversations assembly (memory
// store ⊕ durable rows, DB wins on state) but THROTTLES its reconcile pass:
// that route runs reconcileViaTwilio on EVERY poll (one Twilio REST fetch per
// not-yet-connected call, up to 10 × ~100ms, serialized before the response)
// and reconcileActiveCalls every 8s (up to 8 ElevenLabs round-trips). With N
// supervisors polling a floor, that cost multiplies by N for zero extra truth —
// the webhooks and the cron drainer are the real finalizers. Here the whole
// reconcile step runs at most once per RECONCILE_EVERY_MS per org, gated by a
// module-level timestamp map (same claim-before-work pattern as the transcript
// cursor): whoever wins the gate pays; everyone else gets a plain DB read.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

type DbCall = Awaited<
  ReturnType<typeof getAIConversationsForMonitor>
>["active"][number];

/** The loose union the legacy conversations route also merges over. */
export type MonitorMergeCall = AICall | DbCall;

/**
 * Merge the durable Supabase rows with the in-memory store. THE DATABASE WINS
 * ON STATE — memory is per-instance and only fills fields the DB row doesn't
 * carry (city, conference room, customer leg SID). Extracted verbatim from
 * /api/elevenlabs/conversations so the floor and the legacy feed can never
 * disagree about what "merged" means.
 */
export function mergeMonitorAICalls(
  memory: MonitorMergeCall[],
  db: MonitorMergeCall[],
): MonitorMergeCall[] {
  const byId = new Map<string, MonitorMergeCall>();
  for (const c of memory) byId.set(c.conversationId, c);

  for (const dbCall of db) {
    const mem = byId.get(dbCall.conversationId);
    if (!mem) {
      byId.set(dbCall.conversationId, dbCall);
      continue;
    }
    // Field-wise: the DB's lifecycle facts win; memory only fills what's
    // missing. The explicit `?? mem.x` restores matter — spreading `...dbCall`
    // over `...mem` copies the DB's UNDEFINED fields too, which would silently
    // erase values memory had.
    const dbIsAhead = liveStateRank(dbCall.state) >= liveStateRank(mem.state);
    byId.set(dbCall.conversationId, {
      ...mem,
      ...dbCall,
      city: dbCall.city || (mem as AICall).city || "",
      state: dbIsAhead ? dbCall.state : mem.state,
      ringingAt: dbCall.ringingAt ?? (mem as AICall).ringingAt,
      connectedAt: dbCall.connectedAt ?? (mem as AICall).connectedAt,
      endedAt: dbCall.endedAt ?? mem.endedAt,
      outcome: dbCall.outcome ?? mem.outcome,
    } as MonitorMergeCall);
  }
  return [...byId.values()];
}

/** Reconcile against the providers at most this often PER ORG. */
const RECONCILE_EVERY_MS = 15_000;
const lastReconcileByOrg = new Map<string, number>();

/**
 * The org's live AI calls for the floor snapshot: merged store⊕DB, provider
 * reconcile behind the per-org gate, enriched with owner / campaign attribution
 * (admin client — the monitor read is already supervisor-authorized upstream).
 */
export async function getAiActiveForFloor(orgId: string): Promise<SnapshotAiCall[]> {
  const first = await getAIConversationsForMonitor();
  let active = mergeMonitorAICalls(listActiveAICalls(orgId), first.active).filter(
    (c) => !isTerminalLiveState(c.state),
  );

  if (active.length > 0) {
    const now = Date.now();
    const last = lastReconcileByOrg.get(orgId) ?? 0;
    if (now - last > RECONCILE_EVERY_MS) {
      // Claim the gate BEFORE the slow work — a concurrent snapshot request
      // sees the fresh stamp and skips straight to the DB read.
      lastReconcileByOrg.set(orgId, now);
      try {
        const refs = active.map((c) => ({
          conversationId: c.conversationId,
          startedAt: c.startedAt,
        }));
        await reconcileViaTwilio(refs.map((r) => r.conversationId));
        await reconcileActiveCalls(refs);
      } catch {
        /* best-effort — webhooks + cron are the guarantee */
      }
      // Re-read so a call that just ended leaves the floor in this response.
      const fresh = await getAIConversationsForMonitor();
      active = mergeMonitorAICalls(listActiveAICalls(orgId), fresh.active).filter(
        (c) => !isTerminalLiveState(c.state),
      );
      count("floor.ai_reconcile", 1, { orgId });
    }
  }

  const enrich = await loadAiAttribution(
    orgId,
    active.map((c) => c.conversationId),
  );

  return active
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((c) => {
      const extra = enrich.get(c.conversationId);
      const state =
        c.state === "in_progress" || c.state === "ringing" ? c.state : "initiated";
      return {
        conversationId: c.conversationId,
        ownerId: extra?.ownerId ?? null,
        repName: extra?.repName ?? "",
        leadId: (c as AICall).leadId ?? extra?.leadId ?? null,
        leadName: c.leadName ?? "",
        phone: c.phone ?? "",
        city: (c as AICall).city ?? "",
        state,
        startedAt: c.startedAt,
        ringingAt: c.ringingAt ?? null,
        connectedAt: c.connectedAt ?? null,
        campaignId: extra?.campaignId ?? null,
        campaignName: extra?.campaignName ?? "",
      };
    });
}

interface AiAttribution {
  ownerId: string | null;
  repName: string;
  leadId: string | null;
  campaignId: string | null;
  campaignName: string;
}

/**
 * Owner + campaign attribution for AI calls. Neither the memory store nor the
 * monitor mapper exposes owner_id, and campaign lives on the LEAD — so the
 * floor resolves both here (three narrow admin reads, only for the live set).
 * Best-effort: without a service role (demo) cards simply render unattributed.
 */
async function loadAiAttribution(
  orgId: string,
  conversationIds: string[],
): Promise<Map<string, AiAttribution>> {
  const out = new Map<string, AiAttribution>();
  if (!isAdminConfigured() || conversationIds.length === 0) return out;
  try {
    const admin = createAdminClient();
    const { data: convos } = await admin
      .from("ai_conversations")
      .select("conversation_id, owner_id, lead_id")
      .eq("org_id", orgId)
      .in("conversation_id", conversationIds);

    const ownerIds = new Set<string>();
    const leadIds = new Set<string>();
    for (const r of (convos ?? []) as Row[]) {
      if (r.owner_id) ownerIds.add(String(r.owner_id));
      if (r.lead_id) leadIds.add(String(r.lead_id));
    }

    const [membersRes, leadsRes] = await Promise.all([
      ownerIds.size
        ? admin
            .from("organization_members")
            .select("user_id, name")
            .eq("org_id", orgId)
            .in("user_id", [...ownerIds])
        : Promise.resolve({ data: [] as Row[] }),
      leadIds.size
        ? admin.from("leads").select("id, campaign_id").in("id", [...leadIds])
        : Promise.resolve({ data: [] as Row[] }),
    ]);

    const nameById = new Map(
      ((membersRes.data ?? []) as Row[]).map((m) => [
        String(m.user_id),
        String(m.name ?? ""),
      ]),
    );
    const campaignByLead = new Map(
      ((leadsRes.data ?? []) as Row[]).map((l) => [
        String(l.id),
        l.campaign_id ? String(l.campaign_id) : null,
      ]),
    );

    const campaignIds = new Set(
      [...campaignByLead.values()].filter((v): v is string => Boolean(v)),
    );
    const campaignNames = new Map<string, string>();
    if (campaignIds.size) {
      const { data: camps } = await admin
        .from("campaigns")
        .select("id, name")
        .in("id", [...campaignIds]);
      for (const c of (camps ?? []) as Row[]) {
        campaignNames.set(String(c.id), String(c.name ?? ""));
      }
    }

    for (const r of (convos ?? []) as Row[]) {
      const ownerId = r.owner_id ? String(r.owner_id) : null;
      const leadId = r.lead_id ? String(r.lead_id) : null;
      const campaignId = leadId ? (campaignByLead.get(leadId) ?? null) : null;
      out.set(String(r.conversation_id), {
        ownerId,
        repName: ownerId ? (nameById.get(ownerId) ?? "") : "",
        leadId,
        campaignId,
        campaignName: campaignId ? (campaignNames.get(campaignId) ?? "") : "",
      });
    }
  } catch {
    /* attribution is display sugar — never fail the snapshot for it */
  }
  return out;
}

// ── Roster + session pace ────────────────────────────────────────────────────

export interface FloorPace {
  /** Every active org member, so silence renders as "offline" by name. */
  roster: { userId: string; name: string }[];
  /** Calls logged today (org-local day) per rep, from call_records. */
  callsToday: Record<string, number>;
  totalCallsToday: number;
}

const EMPTY_PACE: FloorPace = { roster: [], callsToday: {}, totalCallsToday: 0 };

/** Same source-of-truth queries the dialer's floor strip uses (db/floor.ts). */
export async function getFloorPace(
  orgId: string,
  timezone: string,
): Promise<FloorPace> {
  if (!isAdminConfigured()) return EMPTY_PACE;
  try {
    const admin = createAdminClient();
    const todayKey = zonedDayKey(new Date(), timezone);
    // Wide enough to cover the org's local "today" from any timezone; filtered
    // precisely by local day-key below.
    const since = new Date(Date.now() - 26 * 3_600_000).toISOString();

    const [membersRes, callsRes] = await Promise.all([
      admin
        .from("organization_members")
        .select("user_id, name")
        .eq("org_id", orgId)
        .eq("status", "active"),
      // See db/floor.ts — same query, same truncation, same fix. `.limit(20000)`
      // with no `.range()` was capped at the PostgREST response ceiling, and
      // the DESC order meant the calls it dropped were the morning's.
      admin.rpc("app_floor_calls_by_day", {
        p_org: orgId,
        p_since: since,
        p_tz: timezone,
      }),
    ]);

    const roster = ((membersRes.data ?? []) as Row[]).map((m) => ({
      userId: String(m.user_id),
      name: String(m.name ?? ""),
    }));

    // `error` was never inspected here either, so a failed query rendered as a
    // floor that had placed no calls today.
    if (callsRes.error) {
      throw new Error(`Couldn't count today's calls: ${callsRes.error.message}`);
    }
    const callsToday: Record<string, number> = {};
    let total = 0;
    for (const c of (callsRes.data ?? []) as Row[]) {
      if (!c.owner_id || String(c.day_key ?? "") !== todayKey) continue;
      const k = String(c.owner_id);
      const n = Number(c.n ?? 0);
      callsToday[k] = (callsToday[k] ?? 0) + n;
      total += n;
    }
    return { roster, callsToday, totalCallsToday: total };
  } catch {
    return EMPTY_PACE;
  }
}
