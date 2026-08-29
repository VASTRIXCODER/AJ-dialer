import "server-only";

import {
  BLOCKED_SEGMENTS,
  sanitizeSegments,
  SEGMENTS,
  type ContactFilter,
  type SessionSpec,
} from "../dialer/segments";
import { getDncDigits, scrubDnc } from "./dnc";
import { rowToLead } from "./leads";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { Lead } from "../types";

/** The caller's currently active org, so "own leads" never crosses org lines. */
async function currentOrgId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data: prof } = await supabase
    .from("profiles")
    .select("org_id")
    .eq("id", userId)
    .maybeSingle();
  return prof?.org_id ? String(prof.org_id) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The session builder: decide exactly WHO gets called before a single call goes out.
//
// Two rules govern everything here.
//
// 1. COUNTS MUST BE EXACT. They are computed with head-only COUNT queries, never
//    by measuring the length of a fetched array. Every count in this product used
//    to be an array length, and PostgREST silently caps arrays at 1,000 rows — so
//    a 16,636-lead segment reported "1000", and the operator planned a campaign
//    against a number that was simply false.
//
// 2. THE QUEUE MUST BE BOUNDED AND UNCAPPED AT THE SAME TIME. Uncapped, in that a
//    5,000-lead session must actually contain 5,000 leads (it used to get 1,000).
//    Bounded, in that it must contain EXACTLY the number asked for — the dialer
//    wraps its queue index modulo length, so an unbounded queue re-dials the same
//    homeowners forever.
// ─────────────────────────────────────────────────────────────────────────────

/** PostgREST's per-response ceiling — pages are requested at exactly this size. */
const PAGE = 1000;
/** The most leads one session may hold. Guards the browser as much as the DB. */
export const MAX_SESSION_LEADS = 10_000;

export interface Segment {
  key: string;
  label: string;
  tier: string;
  hint: string;
  count: number;
}

export interface SegmentReport {
  /** Every lead the viewer owns, regardless of status. */
  total: number;
  /** Never dialed (last_contacted_at IS NULL) — orthogonal to status. */
  neverContacted: number;
  /** Dialed at least once. */
  contacted: number;
  segments: Segment[];
  /** Sum of the selectable (non-blocked) segments. */
  dialableTotal: number;
}

/**
 * Per-segment counts for the whole book. Own-scoped, matching the dial queue:
 * the power dialer only ever calls leads you uploaded, so the planner must count
 * exactly the same population it will later dial.
 */
export async function getSegmentReport(): Promise<SegmentReport> {
  const empty: SegmentReport = {
    total: 0,
    neverContacted: 0,
    contacted: 0,
    segments: [],
    dialableTotal: 0,
  };
  if (!isSupabaseConfigured()) return empty;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return empty;
    const orgId = await currentOrgId(supabase, user.id);

    // head:true + count:"exact" asks Postgres for a COUNT and ships zero rows —
    // so it is immune to the 1,000-row cap that corrupted every other total.
    const countOf = async (apply?: (q: ReturnType<typeof base>) => unknown) => {
      const q = base();
      apply?.(q);
      const { count } = await q;
      return count ?? 0;
    };
    function base() {
      // Own-scoped, AND within the CURRENT org — a lead this account uploaded
      // under a past org must not count toward a freshly joined/created one.
      let q = supabase.from("leads").select("id", { count: "exact", head: true }).eq("owner_id", user!.id);
      if (orgId) q = q.eq("org_id", orgId);
      return q;
    }

    const [total, neverContacted, contacted, ...counts] = await Promise.all([
      countOf(),
      countOf((q) => q.is("last_contacted_at", null)),
      countOf((q) => q.not("last_contacted_at", "is", null)),
      ...SEGMENTS.map((s) => countOf((q) => q.eq("status", s.key))),
    ]);

    const segments: Segment[] = SEGMENTS.map((s, i) => ({
      key: s.key,
      label: s.label,
      tier: s.tier,
      hint: s.hint,
      count: counts[i] ?? 0,
    }));

    const blocked = new Set<string>(BLOCKED_SEGMENTS);
    return {
      total,
      neverContacted,
      contacted,
      segments,
      dialableTotal: segments
        .filter((s) => !blocked.has(s.key))
        .reduce((sum, s) => sum + s.count, 0),
    };
  } catch {
    return empty;
  }
}

function applyContact<T>(q: T, contact: ContactFilter): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = q as any;
  if (contact === "never") return b.is("last_contacted_at", null);
  if (contact === "contacted") return b.not("last_contacted_at", "is", null);
  return b;
}

/** How many leads a given spec would actually dial — the honest pre-flight number. */
export async function countSession(spec: SessionSpec): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return 0;
    const orgId = await currentOrgId(supabase, user.id);

    let q = supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .in("status", sanitizeSegments(spec.statuses));
    // Own-scoped, AND within the CURRENT org — never count a past org's leads.
    if (orgId) q = q.eq("org_id", orgId);
    q = applyContact(q, spec.contact);
    if (spec.campaignId) q = q.eq("campaign_id", spec.campaignId);

    const { count } = await q;
    return Math.min(count ?? 0, spec.limit);
  } catch {
    return 0;
  }
}

/**
 * Materialise the session: the exact, ordered list of leads this run will dial.
 *
 * Pages past the 1,000-row cap, then truncates to `spec.limit` — so "call 5,000
 * of my 16,636 new leads, least-recently-contacted first" produces exactly 5,000
 * leads in that order, and the dialer stops when it reaches the end of them.
 *
 * `dnc` is stripped server-side by sanitizeSegments(), so it cannot be dialed
 * even by a hand-rolled request that bypasses the UI.
 */
export async function buildSession(spec: SessionSpec): Promise<Lead[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];
    const orgId = await currentOrgId(supabase, user.id);

    const limit = Math.max(1, Math.min(spec.limit || 0, MAX_SESSION_LEADS));

    // An explicit hand-picked set skips the segment filters entirely — but still
    // never escapes the owner scope, the current org, or the DNC block.
    if (spec.leadIds?.length) {
      const ids = spec.leadIds.slice(0, limit);
      const out: Lead[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        let q = supabase
          .from("leads")
          .select("*")
          .eq("owner_id", user.id)
          .not("status", "in", `(${BLOCKED_SEGMENTS.join(",")})`)
          .in("id", ids.slice(i, i + 200));
        if (orgId) q = q.eq("org_id", orgId);
        const { data } = await q;
        out.push(...(data ?? []).map(rowToLead));
      }
      // Preserve the order the operator picked them in.
      const rank = new Map(ids.map((id, i) => [id, i]));
      const picked = out.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
      // Scrub the org's number-level suppression list too — status alone misses
      // numbers added via SMS STOP / DNC import whose lead row is still dialable.
      return orgId ? scrubDnc(picked, await getDncDigits(orgId)) : picked;
    }

    const statuses = sanitizeSegments(spec.statuses);
    const order = spec.order;

    const page = (from: number) => {
      let q = supabase
        .from("leads")
        .select("*")
        .eq("owner_id", user.id)
        .in("status", statuses);
      // Own-scoped, AND within the CURRENT org — a lead uploaded under a past
      // org must never join a session dialed in a freshly joined/created one.
      if (orgId) q = q.eq("org_id", orgId);
      q = applyContact(q, spec.contact);
      if (spec.campaignId) q = q.eq("campaign_id", spec.campaignId);

      if (order === "ai_score") {
        q = q.order("ai_score", { ascending: false, nullsFirst: false });
      } else if (order === "oldest") {
        q = q.order("created_at", { ascending: true });
      } else {
        // Least recently contacted first — never-contacted leads sort first,
        // which is what you want: they're the freshest opportunity.
        q = q.order("last_contacted_at", { ascending: true, nullsFirst: true });
      }
      // A stable tiebreak, or paging can repeat/skip rows across pages.
      return q.order("id", { ascending: true }).range(from, from + PAGE - 1);
    };

    const out: Lead[] = [];
    for (let from = 0; from < limit; from += PAGE) {
      const { data, error } = await page(from);
      if (error) break;
      const rows = data ?? [];
      out.push(...rows.map(rowToLead));
      if (rows.length < PAGE) break; // short page ⇒ end of the book
    }

    // Number-level DNC scrub (dnc_numbers): the status filter can't see a
    // number suppressed via SMS STOP or a DNC import when its lead row still
    // carries a dialable status. The dial route re-scrubs at call time, but the
    // queue the rep SEES must be honest too.
    const scrubbed = orgId ? scrubDnc(out, await getDncDigits(orgId)) : out;

    // EXACTLY the requested count. The dialer's queue index wraps modulo length,
    // so handing it more than the operator asked for means dialing people they
    // never agreed to call.
    return scrubbed.slice(0, limit);
  } catch {
    return [];
  }
}
