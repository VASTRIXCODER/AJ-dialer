import "server-only";

import {
  BLOCKED_SEGMENTS,
  sanitizeGroups,
  sanitizeSegments,
  SEGMENTS,
  type ContactFilter,
  type SessionSpec,
} from "../dialer/segments";
import { getDncDigits, scrubDnc } from "./dnc";
import { rowToLead } from "./leads";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { Lead } from "../types";
import { readProfileScope } from "./scope";

interface SessionScope {
  userId: string;
  orgId: string | null;
  /** True ⇒ this caller MAY build org-wide (still opt-in per spec.orgWide). */
  supervisor: boolean;
}

async function resolveSessionScope(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<SessionScope | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  // Throws when the profile or the membership cannot be read, rather than
  // silently answering "rep" — which here means an org-wide session quietly
  // builds from one person's own uploads.
  const prof = await readProfileScope(supabase, user.id, "org_id, role, disabled");
  // A suspended account gets NOTHING here — the org-wide path below reads
  // through the service-role client, which bypasses the RLS backstop that
  // suspension otherwise relies on when the auth ban API hiccups.
  if (prof.disabled) return null;
  return {
    userId: user.id,
    orgId: prof.org_id,
    supervisor: prof.supervisor && isAdminConfigured(),
  };
}

/**
 * Groups filter ("unsorted" = leads with no group). Keys are validated to a
 * slug charset before entering the PostgREST or() string.
 */
function applyGroups<T>(q: T, groups?: string[]): T {
  const safe = sanitizeGroups(groups).filter((g) => /^[a-z0-9_-]+$/i.test(g));
  if (!safe.length) return q;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b = q as any;
  const named = safe.filter((g) => g !== "unsorted");
  const unsorted = safe.includes("unsorted");
  if (unsorted && named.length) {
    return b.or(`lead_group.is.null,lead_group.in.(${named.join(",")})`);
  }
  if (unsorted) return b.is("lead_group", null);
  return b.in("lead_group", named);
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
 * Per-segment counts for the book the session will actually dial: own-scoped
 * by default; `orgWide` (supervisors only) counts the whole org's pool so the
 * planner's numbers match an org-wide session's population.
 */
export async function getSegmentReport(opts?: { orgWide?: boolean }): Promise<SegmentReport> {
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
    const scope = await resolveSessionScope(supabase);
    if (!scope) return empty;
    const orgWide = Boolean(opts?.orgWide && scope.supervisor && scope.orgId);
    const reader = orgWide ? createAdminClient() : supabase;
    const orgId = scope.orgId;

    // head:true + count:"exact" asks Postgres for a COUNT and ships zero rows —
    // so it is immune to the 1,000-row cap that corrupted every other total.
    const countOf = async (apply?: (q: ReturnType<typeof base>) => unknown) => {
      const q = base();
      apply?.(q);
      const { count } = await q;
      return count ?? 0;
    };
    function base() {
      // Always within the CURRENT org — a lead this account uploaded under a
      // past org must not count toward a freshly joined/created one.
      let q = reader.from("leads").select("id", { count: "exact", head: true });
      if (!orgWide) q = q.eq("owner_id", scope!.userId);
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
    const scope = await resolveSessionScope(supabase);
    if (!scope) return 0;
    // Org-wide is supervisor-only and requires an org — a rep's spec.orgWide
    // is silently own-scoped, exactly like getDialQueue.
    const orgWide = Boolean(spec.orgWide && scope.supervisor && scope.orgId);
    const reader = orgWide ? createAdminClient() : supabase;

    let q = reader
      .from("leads")
      .select("id", { count: "exact", head: true })
      .in("status", sanitizeSegments(spec.statuses));
    if (!orgWide) q = q.eq("owner_id", scope.userId);
    // Always within the CURRENT org — never count a past org's leads.
    if (scope.orgId) q = q.eq("org_id", scope.orgId);
    q = applyContact(q, spec.contact);
    q = applyGroups(q, spec.groups);
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
    const scope = await resolveSessionScope(supabase);
    if (!scope) return [];
    // Org-wide only for supervisors with an org (mirrors getDialQueue); a
    // rep's spec.orgWide silently stays own-scoped.
    const orgWide = Boolean(spec.orgWide && scope.supervisor && scope.orgId);
    const reader = orgWide ? createAdminClient() : supabase;
    const orgId = scope.orgId;

    const limit = Math.max(1, Math.min(spec.limit || 0, MAX_SESSION_LEADS));

    // An explicit hand-picked set skips the segment filters entirely — but still
    // never escapes the scope, the current org, or the DNC block.
    if (spec.leadIds?.length) {
      const ids = spec.leadIds.slice(0, limit);
      const out: Lead[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        let q = reader
          .from("leads")
          .select("*")
          .not("status", "in", `(${BLOCKED_SEGMENTS.join(",")})`)
          .in("id", ids.slice(i, i + 200));
        if (!orgWide) q = q.eq("owner_id", scope.userId);
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
      let q = reader
        .from("leads")
        .select("*")
        .in("status", statuses);
      if (!orgWide) q = q.eq("owner_id", scope.userId);
      // Always within the CURRENT org — a lead uploaded under a past org must
      // never join a session dialed in a freshly joined/created one.
      if (orgId) q = q.eq("org_id", orgId);
      q = applyContact(q, spec.contact);
      q = applyGroups(q, spec.groups);
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
