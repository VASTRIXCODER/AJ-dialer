import { rolePermissions, type OrgRole } from "../permissions";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// "The top N reps get the AI dialer."
//
// A standing RULE, not a one-off grant: it is re-evaluated from live numbers, so
// a rep who climbs into the top N gains access and one who drops out loses it
// without anybody editing a permission.
//
// Ranked on APPOINTMENTS BOOKED over a rolling 7 days. Two deliberate choices:
//  • Appointments, because that is the outcome this product exists to produce —
//    dials and talk time are activity, not results.
//  • Rolling 7 days rather than "today", because access that recomputes from
//    today's numbers can be pulled out from under a rep mid-shift the moment a
//    teammate overtakes them. A week's window moves slowly enough to be fair.
//
// Deliberately NOT the leaderboard: getTeamLeaderboard() pulls 90 days of call
// records, appointments and callbacks (paged to 50k rows) and ranks in Node,
// uncached — far too heavy to sit behind getViewer(), which runs on every page
// render. This needs two narrow indexed reads instead, memoized per process.
//
// It also does NOT write to organization_members.permissions. That column is
// replaced wholesale by the admin UI and setMemberPermissions, so an automatic
// writer would fight a human editor and leave no trace of which was which. The
// grant is computed at read time and folded UNDERNEATH the stored overrides, so
// an admin who explicitly revokes `dialer.ai` for someone still wins.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a computed ranking is reused before it's recomputed. */
export const TOP_REPS_TTL_MS = 10 * 60 * 1000;
/** The ranking window: appointments booked in the last 7 days. */
export const TOP_REPS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/** Safety ceiling on the rows pulled — an org booking more than this in a week
 *  is ranked on the most recent slice, which cannot change who is at the top. */
const ROW_CAP = 5000;

export interface TopRepEntry {
  userId: string;
  name: string;
  appointments: number;
  /** 1-based; 1 is the top rep. */
  rank: number;
}

export interface RankableBooking {
  ownerId: string;
  /** Epoch ms of the booking — only used to break ties. */
  at: number;
}

export interface RankableRep {
  userId: string;
  name: string;
}

/**
 * Rank candidates by booking count and take the top `count`.
 *
 * Pure, so the rule that decides who gets access is testable without a database.
 *
 * Ties break toward the rep who reached that count EARLIER (their most recent
 * booking is older), mirroring how the leaderboard's own comparator favours
 * earlier activity. Then by user id, so the result is fully deterministic and a
 * tie can never make access flap between two people on consecutive reads.
 *
 * A rep with zero bookings is never included: "top 3" has to mean three people
 * who actually produced, otherwise a quiet week would hand out access by
 * alphabetical accident.
 */
export function rankTopReps(
  bookings: RankableBooking[],
  candidates: RankableRep[],
  count: number,
): TopRepEntry[] {
  if (count <= 0 || candidates.length === 0) return [];
  const eligible = new Map(candidates.map((c) => [c.userId, c.name]));

  const tally = new Map<string, { appointments: number; latest: number }>();
  for (const b of bookings) {
    if (!eligible.has(b.ownerId)) continue;
    const cur = tally.get(b.ownerId);
    if (cur) {
      cur.appointments += 1;
      if (b.at > cur.latest) cur.latest = b.at;
    } else {
      tally.set(b.ownerId, { appointments: 1, latest: b.at });
    }
  }

  return [...tally.entries()]
    .map(([userId, t]) => ({
      userId,
      name: eligible.get(userId) ?? "",
      appointments: t.appointments,
      latest: t.latest,
    }))
    .sort(
      (a, b) =>
        b.appointments - a.appointments ||
        a.latest - b.latest ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    )
    .slice(0, count)
    .map((e, i) => ({
      userId: e.userId,
      name: e.name,
      appointments: e.appointments,
      rank: i + 1,
    }));
}

// ── Cache ────────────────────────────────────────────────────────────────────
// Per-process memo. getViewer() runs on every render, so the ranking must not
// cost a query each time; on the other hand this must not go stale for long or
// a rep would keep access they've lost. Ten minutes is the compromise. Each
// serverless instance keeps its own copy, so two instances can briefly disagree
// — harmless, since the worst case is a rep keeping access a few extra minutes.

interface CacheEntry {
  entries: TopRepEntry[];
  at: number;
}
const cache = new Map<string, CacheEntry>();

/** Drop memoized rankings — used by tests and after the setting changes. */
export function invalidateTopReps(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

/**
 * The reps currently entitled to the AI dialer by the top-N rule.
 *
 * Only members whose ROLE doesn't already grant `dialer.ai` are ranked — a
 * manager sitting at the top of the board would otherwise consume a slot to be
 * handed access they already have, quietly shrinking the reward to two reps.
 */
export async function topRepsForOrg(
  orgId: string | null | undefined,
  count: number,
): Promise<TopRepEntry[]> {
  if (!orgId || count <= 0 || !isAdminConfigured()) return [];

  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TOP_REPS_TTL_MS) return hit.entries;

  try {
    const admin = createAdminClient();
    const since = new Date(Date.now() - TOP_REPS_WINDOW_MS).toISOString();

    // Two narrow reads, both on indexed columns:
    //   organization_members → org_members_org_idx (org_id, status)
    //   call_records         → call_records_org_started_idx (org_id, started_at)
    // Service-role on purpose: under RLS a rep sees only their OWN call records,
    // so a ranking read as the viewer would rank everyone at zero but themselves.
    const [membersRes, bookingsRes] = await Promise.all([
      admin
        .from("organization_members")
        .select("user_id,name,role")
        .eq("org_id", orgId)
        .eq("status", "active"),
      admin
        .from("call_records")
        .select("owner_id,started_at")
        .eq("org_id", orgId)
        .eq("outcome", "appointment_booked")
        .gte("started_at", since)
        .order("started_at", { ascending: false })
        .limit(ROW_CAP),
    ]);

    const candidates: RankableRep[] = (
      (membersRes.data ?? []) as { user_id?: string; name?: string; role?: string }[]
    )
      .filter((m) => !rolePermissions(m.role as OrgRole).includes("dialer.ai"))
      .map((m) => ({ userId: String(m.user_id ?? ""), name: String(m.name ?? "") }))
      .filter((m) => m.userId);

    const bookings: RankableBooking[] = (
      (bookingsRes.data ?? []) as { owner_id?: string; started_at?: string }[]
    )
      .map((r) => ({
        ownerId: String(r.owner_id ?? ""),
        at: Date.parse(String(r.started_at ?? "")) || 0,
      }))
      .filter((r) => r.ownerId);

    const entries = rankTopReps(bookings, candidates, count);
    cache.set(orgId, { entries, at: Date.now() });
    return entries;
  } catch {
    // Never let a ranking failure break page rendering — fall back to whatever
    // was last computed, or to "nobody", which just means role defaults apply.
    return hit?.entries ?? [];
  }
}
