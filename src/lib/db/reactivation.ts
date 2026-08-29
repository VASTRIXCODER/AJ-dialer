import "server-only";

import {
  reactivationCutoffIso,
  type ReactivationCohort,
} from "../dialer/reactivation";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import type { Scope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// Reactivation candidate discovery (P2.9). This module only decides WHO is in
// a cohort; materialising the dial list goes through buildSession({leadIds}),
// which re-applies the scope fence, the org fence, the DNC status block and
// the number-level scrub. Defense in depth on purpose.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

/** Fetch headroom above the ask, so exclusions don't starve the list. */
const SCAN_MULTIPLIER = 3;
const SCAN_CAP = 600;

export interface CohortCandidates {
  ids: string[];
  /** Honest bookkeeping of what the exclusions removed from the scan. */
  excluded: { openCallback: number; held: number; badPhone: number };
  /** True when the scan hit its cap — there may be more beyond it. */
  scanCapped: boolean;
}

function candidateQuery(input: {
  scope: Scope;
  cohort: ReactivationCohort;
  orgWide: boolean;
  now: Date;
}) {
  const { scope, cohort, orgWide, now } = input;
  const cutoff = reactivationCutoffIso(cohort, now);
  const admin = createAdminClient();
  let q = admin
    .from("leads")
    .select(
      "id, phone, status, last_attempt_at, created_at, attempt_count, reserved_by, reserved_until",
    )
    .eq("org_id", scope.orgId as string)
    .is("archived_at", null)
    .in("status", cohort.statuses);
  if (!orgWide) q = q.eq("owner_id", scope.userId);
  if (cohort.agedField === "created") {
    q = q.lt("created_at", cutoff);
  } else {
    // "Quiet since": last attempt before the cutoff — or never attempted but
    // CREATED before it (dirty data where the status says attempted but the
    // clock was never stamped must not sneak a fresh lead into a sweep).
    q = q.or(
      `last_attempt_at.lt.${cutoff},and(last_attempt_at.is.null,created_at.lt.${cutoff})`,
    );
  }
  if (cohort.maxAttempts === 0) {
    q = q.eq("attempt_count", 0);
  } else {
    q = q.lt("attempt_count", cohort.maxAttempts);
  }
  // Longest-quiet first — the least recently worked book is the point.
  return q
    .order(cohort.agedField === "created" ? "created_at" : "last_attempt_at", {
      ascending: true,
      nullsFirst: true,
    })
    .order("id", { ascending: true });
}

/** Raw candidate count (before per-lead exclusions) — the planner number. */
export async function countReactivationCohort(input: {
  scope: Scope;
  cohort: ReactivationCohort;
  orgWide: boolean;
}): Promise<number> {
  if (!isAdminConfigured() || !input.scope.orgId) return 0;
  try {
    const cutoff = reactivationCutoffIso(input.cohort, new Date());
    const admin = createAdminClient();
    let q = admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("org_id", input.scope.orgId)
      .is("archived_at", null)
      .in("status", input.cohort.statuses);
    if (!input.orgWide) q = q.eq("owner_id", input.scope.userId);
    if (input.cohort.agedField === "created") {
      q = q.lt("created_at", cutoff);
    } else {
      q = q.or(
        `last_attempt_at.lt.${cutoff},and(last_attempt_at.is.null,created_at.lt.${cutoff})`,
      );
    }
    if (input.cohort.maxAttempts === 0) q = q.eq("attempt_count", 0);
    else q = q.lt("attempt_count", input.cohort.maxAttempts);
    const { count } = await q;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The cohort's dialable ids, longest-quiet first, after the hard exclusions:
 * open callback (a promise beats a sweep), held by another rep, no dialable
 * number. DNC is excluded twice more downstream (status block + number scrub
 * in buildSession) — nothing here relies on remembering that.
 */
export async function listReactivationCandidates(input: {
  scope: Scope;
  cohort: ReactivationCohort;
  orgWide: boolean;
  limit: number;
}): Promise<CohortCandidates> {
  const empty: CohortCandidates = {
    ids: [],
    excluded: { openCallback: 0, held: 0, badPhone: 0 },
    scanCapped: false,
  };
  if (!isAdminConfigured() || !input.scope.orgId) return empty;
  try {
    const now = new Date();
    const nowIso = now.toISOString();
    const scan = Math.min(SCAN_CAP, Math.max(input.limit * SCAN_MULTIPLIER, input.limit));
    const { data } = await candidateQuery({ ...input, now }).limit(scan);
    const rows = (data ?? []) as Row[];
    if (!rows.length) return empty;

    // One bounded read: which candidates have an OPEN callback?
    const ids = rows.map((r) => s(r.id));
    const admin = createAdminClient();
    const withCallback = new Set<string>();
    for (let i = 0; i < ids.length; i += 200) {
      const { data: cbs } = await admin
        .from("callbacks")
        .select("lead_id")
        .eq("org_id", input.scope.orgId)
        .not("status", "in", '("completed","cancelled")')
        .in("lead_id", ids.slice(i, i + 200));
      for (const cb of (cbs ?? []) as Row[]) withCallback.add(s(cb.lead_id));
    }

    const excluded = { openCallback: 0, held: 0, badPhone: 0 };
    const out: string[] = [];
    for (const r of rows) {
      const id = s(r.id);
      if (withCallback.has(id)) {
        excluded.openCallback += 1;
        continue;
      }
      if (
        r.reserved_by &&
        s(r.reserved_by) !== input.scope.userId &&
        r.reserved_until &&
        s(r.reserved_until) > nowIso
      ) {
        excluded.held += 1;
        continue;
      }
      if (s(r.phone).replace(/\D/g, "").length < 10) {
        excluded.badPhone += 1;
        continue;
      }
      out.push(id);
      if (out.length >= input.limit) break;
    }
    return { ids: out, excluded, scanCapped: rows.length >= scan };
  } catch {
    return empty;
  }
}
