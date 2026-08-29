import "server-only";

import { publishOrgEvent } from "@/lib/realtime/publish";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Live presence for human (manual Twilio) calls so supervisors can see — and
// listen to — a rep's in-progress call in the Live Monitor. Human calls run in
// the rep's browser via the Twilio Device, so the client registers start /
// connect / end here.
//
// Backed by Supabase (the `live_calls` table) so presence is SHARED across every
// serverless instance: the rep's browser may write on one Vercel instance while
// the supervisor's monitor reads on another, and they must agree. With only
// in-memory state (the previous design) the call flickered in and out of the
// monitor as each poll hit a different instance. Without a service-role key
// (demo / single process) it falls back to an in-memory map.
//
// Scoped by org so the monitor only ever shows an org's own calls.
// ─────────────────────────────────────────────────────────────────────────────

export type HumanCallState = "calling" | "ringing" | "connected";

export interface HumanCall {
  id: string;
  leadName: string;
  city: string;
  phone: string;
  state: HumanCallState;
  startedAt: number;
  /** They picked up. The on-call timer counts from here, not startedAt. */
  connectedAt: number | null;
  ownerId: string | null;
  orgId: string | null;
  repName: string;
}

interface StartInput {
  id: string;
  leadName: string;
  city?: string;
  phone?: string;
  ownerId?: string | null;
  orgId?: string | null;
  repName?: string;
}

const TABLE = "live_calls";
/** A CONNECTED call can legitimately run this long. */
const TTL_MS = 30 * 60_000;
/**
 * A call that never connected cannot. Legs ring for at most 30s (see the
 * `timeout` on the outbound create), so a row still sitting in calling/ringing
 * after this is not live — the rep's tab died, or every leg rang out and nobody
 * told us. Sweeping it on this shorter clock is what stops a no-answer from
 * haunting the monitor for the full half hour.
 */
const RING_TTL_MS = 90_000;

type Row = Record<string, unknown>;

/**
 * Floor broadcast for a human call's lifecycle. Best-effort by contract
 * (publishOrgEvent never throws) — the monitors keep a poll fallback, so a
 * dropped broadcast costs latency, never truth.
 */
function publishHumanState(
  row: {
    id: string;
    orgId: string | null;
    ownerId?: string | null;
    leadId?: string | null;
    leadName?: string;
  },
  state: "calling" | "ringing" | "connected" | "ended",
  terminationReason?: string | null,
): void {
  publishOrgEvent(row.orgId, "call.state", {
    kind: "human",
    id: row.id,
    ownerId: row.ownerId ?? null,
    leadId: row.leadId ?? null,
    leadName: row.leadName ?? "",
    state,
    stateSince: new Date().toISOString(),
    terminationReason: terminationReason ?? null,
  });
}

function toState(v: unknown): HumanCallState {
  return v === "connected" ? "connected" : v === "ringing" ? "ringing" : "calling";
}

function rowToCall(r: Row): HumanCall {
  return {
    id: String(r.id),
    leadName: String(r.lead_name ?? "Manual call"),
    city: String(r.city ?? ""),
    phone: String(r.phone ?? ""),
    state: toState(r.state),
    startedAt: r.started_at ? new Date(String(r.started_at)).getTime() : Date.now(),
    connectedAt: r.connected_at ? new Date(String(r.connected_at)).getTime() : null,
    ownerId: r.owner_id ? String(r.owner_id) : null,
    orgId: r.org_id ? String(r.org_id) : null,
    repName: String(r.rep_name ?? ""),
  };
}

/** Has this row outlived what its state could plausibly justify? */
function isStale(c: HumanCall, now: number): boolean {
  const age = now - c.startedAt;
  return c.state === "connected" ? age > TTL_MS : age > RING_TTL_MS;
}

// ── In-memory fallback (no service role: demo / single process) ──────────────
const mem = new Map<string, HumanCall>();
function memSweep() {
  const now = Date.now();
  for (const [id, c] of mem) if (isStale(c, now)) mem.delete(id);
}

export async function startHumanCall(input: StartInput): Promise<void> {
  if (isAdminConfigured()) {
    try {
      await createAdminClient()
        .from(TABLE)
        .upsert({
          id: input.id,
          org_id: input.orgId ?? null,
          owner_id: input.ownerId ?? null,
          rep_name: input.repName ?? "",
          lead_name: input.leadName || "Manual call",
          city: input.city ?? "",
          phone: input.phone ?? "",
          // "calling", not "ringing": we've asked Twilio to dial, but their phone
          // is not ringing until Twilio SAYS it's ringing. Claiming otherwise is
          // the same class of lie the AI side was telling.
          state: "calling",
          started_at: new Date().toISOString(),
          connected_at: null,
          answered_lead_id: null,
        });
      publishHumanState(
        {
          id: input.id,
          orgId: input.orgId ?? null,
          ownerId: input.ownerId ?? null,
          leadName: input.leadName || "Manual call",
        },
        "calling",
      );
      return;
    } catch {
      /* fall back to memory so a call is never blocked by presence */
    }
  }
  memSweep();
  mem.set(input.id, {
    id: input.id,
    leadName: input.leadName || "Manual call",
    city: input.city ?? "",
    phone: input.phone ?? "",
    state: "calling",
    startedAt: Date.now(),
    connectedAt: null,
    ownerId: input.ownerId ?? null,
    orgId: input.orgId ?? null,
    repName: input.repName ?? "",
  });
}

/**
 * Twilio says the homeowner's phone is ringing. Only advances from "calling" —
 * a straggling ringing event from a losing parallel leg must never drag a call
 * that already connected back to "Ringing".
 */
export async function ringHumanCall(id: string): Promise<void> {
  if (isAdminConfigured()) {
    try {
      // `.select()` returns the rows the guarded update actually advanced, so
      // the broadcast fires only when the transition really happened (a losing
      // late `ringing` publishes nothing) — and hands us the org to publish to.
      const { data } = await createAdminClient()
        .from(TABLE)
        .update({ state: "ringing" })
        .eq("id", id)
        .eq("state", "calling")
        .select("org_id, owner_id, lead_name");
      const row = (data ?? [])[0] as Row | undefined;
      if (row) {
        publishHumanState(
          {
            id,
            orgId: row.org_id ? String(row.org_id) : null,
            ownerId: row.owner_id ? String(row.owner_id) : null,
            leadName: String(row.lead_name ?? ""),
          },
          "ringing",
        );
      }
      return;
    } catch {
      /* fall through */
    }
  }
  const c = mem.get(id);
  if (c && c.state === "calling") c.state = "ringing";
}

/**
 * They picked up. `answeredLeadId` records WHICH lead answered, which is what
 * lets endHumanCallForLeg tell the winning leg from the losing ones in a
 * parallel dial. connected_at is stamped once and never reset, so a duplicate
 * event can't restart the rep's talk timer.
 */
export async function connectHumanCall(
  id: string,
  answeredLeadId?: string | null,
): Promise<void> {
  if (isAdminConfigured()) {
    try {
      const admin = createAdminClient();
      // org/owner/lead ride the same row read the connected_at guard already
      // needs — no extra query to learn where to broadcast.
      const { data } = await admin
        .from(TABLE)
        .select("connected_at, org_id, owner_id, lead_name")
        .eq("id", id)
        .maybeSingle();
      await admin
        .from(TABLE)
        .update({
          state: "connected",
          ...(data?.connected_at ? {} : { connected_at: new Date().toISOString() }),
          ...(answeredLeadId ? { answered_lead_id: answeredLeadId } : {}),
        })
        .eq("id", id);
      if (data) {
        publishHumanState(
          {
            id,
            orgId: data.org_id ? String(data.org_id) : null,
            ownerId: data.owner_id ? String(data.owner_id) : null,
            leadId: answeredLeadId ?? null,
            leadName: String(data.lead_name ?? ""),
          },
          "connected",
        );
      }
      return;
    } catch {
      /* fall through */
    }
  }
  const c = mem.get(id);
  if (c) {
    c.state = "connected";
    c.connectedAt ??= Date.now();
  }
}

export async function endHumanCall(id: string): Promise<void> {
  if (isAdminConfigured()) {
    try {
      // `.select()` on the delete returns the removed row — the one place its
      // org/owner can still be read — so the floor hears about the hang-up.
      const { data } = await createAdminClient()
        .from(TABLE)
        .delete()
        .eq("id", id)
        .select("org_id, owner_id, lead_name");
      const row = (data ?? [])[0] as Row | undefined;
      if (row) {
        publishHumanState(
          {
            id,
            orgId: row.org_id ? String(row.org_id) : null,
            ownerId: row.owner_id ? String(row.owner_id) : null,
            leadName: String(row.lead_name ?? ""),
          },
          "ended",
        );
      }
      return;
    } catch {
      /* fall through */
    }
  }
  mem.delete(id);
}

/**
 * A Twilio leg for this call reached a terminal status. Ending the call on that
 * alone would be wrong: in a 3X parallel dial the LOSING legs are force-released
 * the instant the winner answers, so their `completed`/`canceled` events arrive
 * while the rep is happily talking. Acting on one would rip a live call off the
 * monitor.
 *
 * So we only end the row when the leg that terminated is the leg that ANSWERED.
 * If nobody ever answered, we deliberately do nothing here and let the
 * RING_TTL_MS sweep retire the row — it can't distinguish "the last leg rang out"
 * from "one of three legs rang out" without leg bookkeeping we don't need.
 */
export async function endHumanCallForLeg(
  id: string,
  leadId: string,
): Promise<void> {
  if (!isAdminConfigured()) {
    const c = mem.get(id);
    if (c && c.state === "connected") mem.delete(id);
    return;
  }
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from(TABLE)
      .select("answered_lead_id, org_id, owner_id, lead_name")
      .eq("id", id)
      .maybeSingle();
    const answered = data?.answered_lead_id ? String(data.answered_lead_id) : null;
    if (answered && answered === leadId) {
      await admin.from(TABLE).delete().eq("id", id);
      publishHumanState(
        {
          id,
          orgId: data?.org_id ? String(data.org_id) : null,
          ownerId: data?.owner_id ? String(data.owner_id) : null,
          leadId,
          leadName: String(data?.lead_name ?? ""),
        },
        "ended",
        "completed",
      );
    }
  } catch {
    /* best-effort — the TTL sweep is the backstop */
  }
}

export async function getHumanCall(id: string): Promise<HumanCall | null> {
  if (isAdminConfigured()) {
    try {
      const { data } = await createAdminClient()
        .from(TABLE)
        .select("*")
        .eq("id", id)
        .maybeSingle();
      return data ? rowToCall(data as Row) : null;
    } catch {
      /* fall through */
    }
  }
  return mem.get(id) ?? null;
}

/** Active human calls within an org (the supervisor's monitor view). */
export async function listActiveHumanCallsForOrg(
  orgId: string | null,
): Promise<HumanCall[]> {
  if (!orgId) return [];
  if (isAdminConfigured()) {
    try {
      const admin = createAdminClient();
      const now = Date.now();
      const connectedCutoff = new Date(now - TTL_MS).toISOString();
      const ringCutoff = new Date(now - RING_TTL_MS).toISOString();

      // Best-effort tidy of rows from calls that never sent an explicit end (a
      // tab killed mid-call, or a no-answer nobody reported). Two clocks: a
      // connected call gets the full 30 minutes, but one that never connected is
      // retired after 90s, because it CANNOT still be ringing. Fire-and-forget;
      // never blocks the read.
      //
      // SCOPED to THIS org — the delete used to omit org_id, so any supervisor
      // opening their own monitor swept EVERY org's stale rows (an unscoped
      // cross-tenant write). Each org's rows are tidied when one of its own
      // members reads the monitor; the read's cutoff + isStale filter keep stale
      // rows off every monitor in the meantime anyway.
      admin.from(TABLE).delete().eq("org_id", orgId).lt("started_at", connectedCutoff).then(
        () => {},
        () => {},
      );
      admin
        .from(TABLE)
        .delete()
        .eq("org_id", orgId)
        .in("state", ["calling", "ringing"])
        .lt("started_at", ringCutoff)
        .then(
          () => {},
          () => {},
        );

      const { data } = await admin
        .from(TABLE)
        .select("*")
        .eq("org_id", orgId)
        .gte("started_at", connectedCutoff)
        .order("started_at", { ascending: false });
      // Filter again in-process: the sweeps above are async and may not have
      // landed yet, and a stale row must never reach the monitor even once.
      return ((data ?? []) as Row[])
        .map(rowToCall)
        .filter((c) => !isStale(c, now));
    } catch {
      /* fall through */
    }
  }
  memSweep();
  return [...mem.values()]
    .filter((c) => c.orgId === orgId)
    .sort((a, b) => b.startedAt - a.startedAt);
}
