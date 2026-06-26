import "server-only";

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

export interface HumanCall {
  id: string;
  leadName: string;
  city: string;
  phone: string;
  state: "ringing" | "connected";
  startedAt: number;
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
// Connected calls can run long (talk time), so they linger up to this TTL.
const TTL_MS = 30 * 60_000;
// A RINGING call is different: a real leg rings ≤30s before Twilio marks it
// no-answer. If the rep's browser never sends an explicit "end" (failed call,
// closed tab, lost network), the row would otherwise sit at "Ringing" for the
// full 30-min TTL. Age ringing rows out fast so the monitor never shows a
// phantom "Ringing" for a call that already failed.
const RINGING_TTL_MS = 90_000;

type Row = Record<string, unknown>;

function rowToCall(r: Row): HumanCall {
  return {
    id: String(r.id),
    leadName: String(r.lead_name ?? "Manual call"),
    city: String(r.city ?? ""),
    phone: String(r.phone ?? ""),
    state: r.state === "connected" ? "connected" : "ringing",
    startedAt: r.started_at ? new Date(String(r.started_at)).getTime() : Date.now(),
    ownerId: r.owner_id ? String(r.owner_id) : null,
    orgId: r.org_id ? String(r.org_id) : null,
    repName: String(r.rep_name ?? ""),
  };
}

// ── In-memory fallback (no service role: demo / single process) ──────────────
const mem = new Map<string, HumanCall>();
function memSweep() {
  const now = Date.now();
  for (const [id, c] of mem) {
    const ttl = c.state === "connected" ? TTL_MS : RINGING_TTL_MS;
    if (now - c.startedAt > ttl) mem.delete(id);
  }
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
          state: "ringing",
          started_at: new Date().toISOString(),
        });
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
    state: "ringing",
    startedAt: Date.now(),
    ownerId: input.ownerId ?? null,
    orgId: input.orgId ?? null,
    repName: input.repName ?? "",
  });
}

export async function connectHumanCall(id: string): Promise<void> {
  if (isAdminConfigured()) {
    try {
      await createAdminClient().from(TABLE).update({ state: "connected" }).eq("id", id);
      return;
    } catch {
      /* fall through */
    }
  }
  const c = mem.get(id);
  if (c) c.state = "connected";
}

export async function endHumanCall(id: string): Promise<void> {
  if (isAdminConfigured()) {
    try {
      await createAdminClient().from(TABLE).delete().eq("id", id);
      return;
    } catch {
      /* fall through */
    }
  }
  mem.delete(id);
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
      const cutoff = new Date(now - TTL_MS).toISOString();
      const ringingCutoff = new Date(now - RINGING_TTL_MS).toISOString();
      // Best-effort tidy of rows from calls that never sent an explicit end
      // (e.g. a tab killed mid-call, or a failed leg). Two sweeps: anything past
      // the long TTL, and any still-"ringing" row past the short ringing TTL —
      // the latter is what stops a failed call from showing "Ringing" forever.
      // Fire-and-forget; never blocks the read.
      admin.from(TABLE).delete().lt("started_at", cutoff).then(
        () => {},
        () => {},
      );
      admin
        .from(TABLE)
        .delete()
        .eq("state", "ringing")
        .lt("started_at", ringingCutoff)
        .then(
          () => {},
          () => {},
        );
      const { data } = await admin
        .from(TABLE)
        .select("*")
        .eq("org_id", orgId)
        .gte("started_at", cutoff)
        .order("started_at", { ascending: false });
      // Filter ring-aware so a phantom "ringing" row is hidden the instant it's
      // stale, even before the fire-and-forget delete lands.
      return ((data ?? []) as Row[])
        .map(rowToCall)
        .filter((c) =>
          c.state === "connected" ? true : now - c.startedAt < RINGING_TTL_MS,
        );
    } catch {
      /* fall through */
    }
  }
  memSweep();
  return [...mem.values()]
    .filter((c) => c.orgId === orgId)
    .sort((a, b) => b.startedAt - a.startedAt);
}
