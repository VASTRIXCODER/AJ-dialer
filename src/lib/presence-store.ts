import "server-only";

import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import type { PresenceStatus } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// Live presence for the manager-level Team Status roster. Unlike `live_calls`
// (one row per in-progress CALL, deleted on hangup), this is one row per USER,
// upserted on every dialer heartbeat — so an idle-but-present rep still shows
// up. `status` mirrors DialerStatus (src/lib/use-dialer.ts) and is simply
// overwritten as the rep moves between states.
//
// Backed by Supabase (the `user_presence` table) so presence is SHARED across
// every serverless instance, exactly like `live_calls`. Falls back to an
// in-memory map without a service-role key (demo / single process).
//
// Scoped by org in application code — the table has RLS on with no policies.
// ─────────────────────────────────────────────────────────────────────────────

// Defined in @/lib/types so the roster (a client component) can import it without
// reaching into this server-only module. Re-exported for existing callers.
export type { PresenceStatus };

export interface PresenceLead {
  name?: string;
  city?: string;
  phone?: string;
}

export interface Presence {
  userId: string;
  orgId: string | null;
  status: PresenceStatus;
  leadName: string;
  leadCity: string;
  leadPhone: string;
  aiActiveCount: number;
  updatedAt: number;
  /** When `status` last CHANGED (not the last heartbeat) — drives the roster's timer. */
  statusSince: number;
}

interface UpsertInput {
  userId: string;
  orgId: string | null;
  status: PresenceStatus;
  lead?: PresenceLead | null;
  aiActiveCount?: number;
}

const TABLE = "user_presence";
/** Hard cutoff for garbage-collecting rows an unclean disconnect never cleared. */
const HARD_TTL_MS = 30 * 60_000;
/**
 * Default "still active" window for the roster read — see listPresenceForOrg.
 * MUST track the dialer's HTTP heartbeat cadence (use-dialer.ts, 60s since the
 * realtime floor channel became the primary liveness signal): the window
 * tolerates one dropped beat plus network slack, exactly the ratio the old
 * 20s-beat/45s-window pair had. A window shorter than one beat would blink
 * every genuinely-present rep off the roster between heartbeats.
 */
const DEFAULT_STALE_MS = 130_000;

type Row = Record<string, unknown>;

const VALID_STATUS = new Set<PresenceStatus>(["idle", "dialing", "live", "wrapup", "ai"]);

function rowToPresence(r: Row): Presence {
  const status = String(r.status ?? "idle");
  const updatedAt = r.updated_at ? new Date(String(r.updated_at)).getTime() : Date.now();
  return {
    userId: String(r.user_id),
    orgId: r.org_id ? String(r.org_id) : null,
    status: VALID_STATUS.has(status as PresenceStatus) ? (status as PresenceStatus) : "idle",
    leadName: String(r.lead_name ?? ""),
    leadCity: String(r.lead_city ?? ""),
    leadPhone: String(r.lead_phone ?? ""),
    aiActiveCount: Number(r.ai_active_count ?? 0),
    updatedAt,
    statusSince: r.status_since ? new Date(String(r.status_since)).getTime() : updatedAt,
  };
}

// ── In-memory fallback (no service role: demo / single process) ──────────────
const mem = new Map<string, Presence>();
function memSweep() {
  const now = Date.now();
  for (const [id, p] of mem) if (now - p.updatedAt > HARD_TTL_MS) mem.delete(id);
}

export async function upsertPresence(input: UpsertInput): Promise<void> {
  const lead = input.lead ?? null;
  if (isAdminConfigured()) {
    try {
      const { error } = await createAdminClient().rpc("app_upsert_presence", {
        p_user_id: input.userId,
        p_org_id: input.orgId,
        p_status: input.status,
        p_lead_name: lead?.name ?? "",
        p_lead_city: lead?.city ?? "",
        p_lead_phone: lead?.phone ?? "",
        p_ai_active_count: input.aiActiveCount ?? 0,
      });
      if (!error) return;
    } catch {
      /* fall back to memory so a heartbeat never blocks the dialer */
    }
  }
  memSweep();
  const now = Date.now();
  const prev = mem.get(input.userId);
  mem.set(input.userId, {
    userId: input.userId,
    orgId: input.orgId,
    status: input.status,
    leadName: lead?.name ?? "",
    leadCity: lead?.city ?? "",
    leadPhone: lead?.phone ?? "",
    aiActiveCount: input.aiActiveCount ?? 0,
    updatedAt: now,
    // Same "keep the timer running unless the status actually changed" rule
    // the SQL function applies — mirrored here for the in-memory fallback.
    statusSince: prev && prev.status === input.status ? prev.statusSince : now,
  });
}

export async function clearPresence(userId: string): Promise<void> {
  if (isAdminConfigured()) {
    try {
      await createAdminClient().from(TABLE).delete().eq("user_id", userId);
      return;
    } catch {
      /* fall through */
    }
  }
  mem.delete(userId);
}

/** Active users within an org (the manager's Team Status roster). */
export async function listPresenceForOrg(
  orgId: string | null,
  staleMs = DEFAULT_STALE_MS,
): Promise<Presence[]> {
  if (!orgId) return [];
  if (isAdminConfigured()) {
    try {
      const admin = createAdminClient();
      const hardCutoff = new Date(Date.now() - HARD_TTL_MS).toISOString();
      // Best-effort tidy of rows an unclean disconnect (killed tab) never
      // cleared. Fire-and-forget; never blocks the read. Scoped to this org —
      // unscoped, one manager opening the roster would sweep every other org's
      // rows too.
      admin
        .from(TABLE)
        .delete()
        .eq("org_id", orgId)
        .lt("updated_at", hardCutoff)
        .then(
          () => {},
          () => {},
        );
      const freshCutoff = new Date(Date.now() - staleMs).toISOString();
      const { data, error } = await admin
        .from(TABLE)
        .select("*")
        .eq("org_id", orgId)
        .gte("updated_at", freshCutoff)
        .order("updated_at", { ascending: false });
      // PostgREST reports failure by RETURNING an error, not by throwing, so the
      // catch below never sees it. Ignoring it meant a missing table or a bad
      // grant produced `data: null` — an empty roster, indistinguishable from
      // "nobody is dialing", with nothing logged. Meanwhile upsertPresence()
      // quietly failed over to memory, so writes and reads would land in
      // different places and the roster would stay blank forever. Say so, and
      // fall through to the same fallback the write path uses.
      if (error) {
        console.error(
          "[presence] user_presence read failed — falling back to in-memory " +
            "presence. If this persists, PART 11 of supabase/schema.sql has not " +
            "been applied to this database.",
          error,
        );
      } else {
        return ((data ?? []) as Row[]).map(rowToPresence);
      }
    } catch (err) {
      console.error("[presence] user_presence read threw", err);
    }
  }
  memSweep();
  const cutoff = Date.now() - staleMs;
  return [...mem.values()]
    .filter((p) => p.orgId === orgId && p.updatedAt >= cutoff)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
