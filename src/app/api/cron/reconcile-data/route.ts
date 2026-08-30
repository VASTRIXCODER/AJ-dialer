import { NextResponse } from "next/server";
import { applyCallEvent } from "@/lib/calls/apply-event";
import { writeAudit } from "@/lib/db/app-control";
import { zonedDayKey, zonedDayStartMs } from "@/lib/dialer/schedule";
import {
  connectedRecordFilter,
  isConnectedRecord,
  orgTimezone,
} from "@/lib/metrics/definitions";
import { processLeadIntake } from "@/lib/orchestration/events";
import { listActiveOrgsWithSettings } from "@/lib/org/membership";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { count } from "@/lib/telemetry";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─────────────────────────────────────────────────────────────────────────────
// The Phase-1 data reconciliation job (pg_cron, every 15 minutes — see
// supabase/cron.sql). Three independent, best-effort repairs:
//
//   1. ATTEMPT-COUNTER DRIFT — leads.attempt_count is bumped at DIAL time
//      (app_mark_lead_attempted) while call_records land at DISPOSITION time,
//      so a crash between the two, a replayed webhook, or a hand-deleted record
//      leaves the counter wrong. The counter drives queue ordering
//      (never-dialed-first) and max-attempt gates, so drift silently re-dials
//      or starves real people. We recount from call_records — the same source
//      the PART 25 backfill used — for leads touched recently.
//
//   2. STUCK ATTEMPTS — call_attempts that sat in a non-terminal state for
//      30+ minutes. The push path (Twilio status webhooks / the ElevenLabs
//      reconciler) is the fast path; this is the backstop for a dropped
//      webhook or a process killed mid-call. attempt.reconciled is the ONE
//      event type with force authority in apply-event.ts: a call_records row
//      proves the call really happened → "completed"; no record after 2h
//      means nobody was ever reached → "no_answer".
//
//   3. METRIC DRIFT — the dashboard numbers come from the app_metrics_summary
//      RPC (PART 26). We independently head-count call_records for yesterday
//      (org-local day) with the same scope predicate and log any disagreement
//      to audit_log ("metric_drift") — the D7 design rule: live aggregates,
//      verified by reconciliation, never silently wrong.
//
// Each job is individually try/caught and bounded per tick: a failure or a
// backlog in one must never starve the others, and the next tick resumes
// whatever was left. Security: same contract as the sibling crons — requires
// `Authorization: Bearer $CRON_SECRET`, refuses to run without one.
// ─────────────────────────────────────────────────────────────────────────────

type Admin = ReturnType<typeof createAdminClient>;

const PAGE = 1_000;
/** Row budget for each paged read — keeps a tick bounded no matter the backlog. */
const ROW_BUDGET = 5_000;
/** How far back "recently touched" reaches for the counter recount. */
const TOUCHED_HOURS = 48;
/** Most leads recounted per tick (the recount reads EVERY record per lead). */
const LEAD_CAP = 300;
/** Most stuck attempts examined per tick. */
const STUCK_CAP = 200;
/** Most orgs drift-checked per tick. */
const ORG_CAP = 20;

const NON_TERMINAL_STATES = [
  "queued",
  "reserved",
  "dialing",
  "ringing",
  "human_connected",
  "voicemail_connected",
  "wrap_up",
];

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function ts(iso: string | null | undefined): number {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(n) ? n : 0;
}

// ── Job 1: attempt-counter drift ─────────────────────────────────────────────

async function repairAttemptCounters(
  admin: Admin,
  now: Date,
): Promise<Record<string, unknown>> {
  const cutoff = new Date(now.getTime() - TOUCHED_HOURS * 3_600_000).toISOString();

  // Pass 1 — which leads were touched recently? Ascending order keeps offset
  // paging stable while new records append at the tail of the window.
  const touched = new Set<string>();
  for (let off = 0; off < ROW_BUDGET; off += PAGE) {
    const { data, error } = await admin
      .from("call_records")
      .select("lead_id")
      .gte("started_at", cutoff)
      .not("lead_id", "is", null)
      .order("started_at", { ascending: true })
      .range(off, off + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { lead_id: string | null }[];
    for (const r of rows) if (r.lead_id) touched.add(r.lead_id);
    if (rows.length < PAGE) break;
  }
  const leadIds = [...touched].slice(0, LEAD_CAP);
  if (!leadIds.length) return { leadsChecked: 0, repaired: 0 };

  // Pass 2 — the TRUE count is every call_records row for the lead (exactly
  // what the PART 25 backfill counted), not just the recent window. Ordered by
  // lead_id so if the row budget truncates the read, only the trailing lead is
  // possibly partial — we drop it from comparison instead of "repairing" a
  // correct counter down to a truncated one.
  const tally = new Map<string, { n: number; latestMs: number }>();
  let budget = ROW_BUDGET;
  let partialLead: string | null = null;
  outer: for (const ids of chunk(leadIds, 100)) {
    for (let off = 0; budget > 0; off += PAGE) {
      const take = Math.min(PAGE, budget);
      const { data, error } = await admin
        .from("call_records")
        .select("lead_id, started_at")
        .in("lead_id", ids)
        .order("lead_id", { ascending: true })
        .range(off, off + take - 1);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as { lead_id: string; started_at: string }[];
      budget -= rows.length;
      for (const r of rows) {
        const t = tally.get(r.lead_id) ?? { n: 0, latestMs: 0 };
        t.n += 1;
        t.latestMs = Math.max(t.latestMs, ts(r.started_at));
        tally.set(r.lead_id, t);
        partialLead = r.lead_id;
      }
      if (rows.length < take) {
        partialLead = null; // chunk fully read — nothing is mid-lead
        break;
      }
      if (budget <= 0) break outer; // ran out mid-chunk: partialLead may be cut short
    }
  }
  if (partialLead) tally.delete(partialLead);
  if (!tally.size) return { leadsChecked: 0, repaired: 0 };

  let repaired = 0;
  const compareIds = [...tally.keys()];
  for (const ids of chunk(compareIds, 100)) {
    const { data, error } = await admin
      .from("leads")
      .select("id, attempt_count, last_attempt_at")
      .in("id", ids);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      id: string;
      attempt_count: number;
      last_attempt_at: string | null;
    }[];
    for (const lead of rows) {
      const truth = tally.get(lead.id);
      if (!truth || truth.n === lead.attempt_count) continue;
      const patch: Record<string, unknown> = { attempt_count: truth.n };
      // last_attempt_at is stamped at dial time and may legitimately be LATER
      // than the newest record's started_at — never move it backward.
      if (truth.latestMs > ts(lead.last_attempt_at)) {
        patch.last_attempt_at = new Date(truth.latestMs).toISOString();
      }
      // CAS on the observed counter: if a dial bumped it between our read and
      // this write, the lead is mid-flight — leave it for the next tick rather
      // than clobber the newer count.
      const { data: updated } = await admin
        .from("leads")
        .update(patch)
        .eq("id", lead.id)
        .eq("attempt_count", lead.attempt_count)
        .select("id");
      if (updated && updated.length > 0) repaired++;
    }
  }
  return { leadsChecked: tally.size, repaired };
}

// ── Job 2: stuck attempts ────────────────────────────────────────────────────

interface StuckAttempt {
  id: string;
  lead_id: string | null;
  room: string | null;
  conversation_id: string | null;
  state: string;
  state_changed_at: string;
  call_record_id: string | null;
}

/** Which stuck attempts already have a call_records projection? */
async function attemptsWithRecords(
  admin: Admin,
  stuck: StuckAttempt[],
): Promise<Set<string>> {
  const have = new Set<string>();
  const rest = stuck.filter((a) => {
    if (a.call_record_id) {
      have.add(a.id);
      return false;
    }
    return true;
  });

  for (const ids of chunk(rest.map((a) => a.id), 100)) {
    const { data } = await admin
      .from("call_records")
      .select("attempt_id")
      .in("attempt_id", ids);
    for (const r of (data ?? []) as { attempt_id: string | null }[]) {
      if (r.attempt_id) have.add(r.attempt_id);
    }
  }

  const byConvo = rest.filter((a) => !have.has(a.id) && a.conversation_id);
  for (const group of chunk(byConvo, 100)) {
    const { data } = await admin
      .from("call_records")
      .select("conversation_id")
      .in("conversation_id", group.map((a) => a.conversation_id as string));
    const found = new Set(
      ((data ?? []) as { conversation_id: string | null }[]).map((r) => r.conversation_id),
    );
    for (const a of group) if (found.has(a.conversation_id)) have.add(a.id);
  }

  // Parallel rounds share one room across attempts — a record counts for THIS
  // attempt only when the (room, lead) pair matches, same rule as apply-event.
  const byRoom = rest.filter((a) => !have.has(a.id) && a.room);
  for (const group of chunk(byRoom, 100)) {
    const { data } = await admin
      .from("call_records")
      .select("room, lead_id")
      .in("room", group.map((a) => a.room as string));
    const pairs = new Set(
      ((data ?? []) as { room: string | null; lead_id: string | null }[]).map(
        (r) => `${r.room}::${r.lead_id ?? ""}`,
      ),
    );
    for (const a of group) {
      if (pairs.has(`${a.room}::${a.lead_id ?? ""}`)) have.add(a.id);
    }
  }
  return have;
}

async function reconcileStuckAttempts(
  admin: Admin,
  now: Date,
  deadlineMs: number,
): Promise<Record<string, unknown>> {
  const staleBefore = new Date(now.getTime() - 30 * 60_000).toISOString();
  const abandonedBefore = now.getTime() - 2 * 3_600_000;

  const { data, error } = await admin
    .from("call_attempts")
    .select("id, lead_id, room, conversation_id, state, state_changed_at, call_record_id")
    .in("state", NON_TERMINAL_STATES)
    .lt("state_changed_at", staleBefore)
    .order("state_changed_at", { ascending: true })
    .limit(STUCK_CAP);
  if (error) throw new Error(error.message);
  const stuck = (data ?? []) as StuckAttempt[];
  if (!stuck.length) return { checked: 0, reconciled: 0 };

  const haveRecord = await attemptsWithRecords(admin, stuck);

  let reconciled = 0;
  let skipped = 0;
  let ranOutOfTime = false;
  for (const attempt of stuck) {
    if (Date.now() > deadlineMs) {
      ranOutOfTime = true;
      break;
    }
    const hasRecord = haveRecord.has(attempt.id);
    // No record yet and under 2h old: the wrap-up or webhook may still be on
    // its way — leave it alone this tick.
    if (!hasRecord && ts(attempt.state_changed_at) > abandonedBefore) {
      skipped++;
      continue;
    }
    const res = await applyCallEvent({
      source: "cron",
      type: "attempt.reconciled",
      attemptRef: { attemptId: attempt.id },
      // A record proves the call happened and was filed → completed. No record
      // after 2h means nobody was ever reached → no_answer (an honest transport
      // verdict, not "failed" — the provider didn't error, the call just died).
      targetState: hasRecord ? "completed" : "no_answer",
      payload: {
        reason: hasRecord ? "record_exists" : "abandoned",
        stuckState: attempt.state,
        stuckSince: attempt.state_changed_at,
      },
    });
    if (res.applied === "applied") reconciled++;
  }
  return {
    checked: stuck.length,
    reconciled,
    ...(skipped ? { awaitingRecord: skipped } : {}),
    ...(ranOutOfTime ? { truncated: true } : {}),
  };
}

// ── Job 3: metric drift check ────────────────────────────────────────────────

async function checkMetricDrift(
  admin: Admin,
  now: Date,
): Promise<Record<string, unknown>> {
  const orgs = (await listActiveOrgsWithSettings()).slice(0, ORG_CAP);
  let drifts = 0;
  let checked = 0;
  const errors: string[] = [];

  for (const org of orgs) {
    try {
      // Yesterday, on the org's own calendar (DST-safe: local midnights, not
      // now-24h) — a CLOSED day, so both counts read settled data.
      const tz = orgTimezone(org);
      const todayStartMs = zonedDayStartMs(now.getTime(), tz);
      const yesterdayStartMs = zonedDayStartMs(todayStartMs - 1, tz);
      const fromIso = new Date(yesterdayStartMs).toISOString();
      const toIso = new Date(todayStartMs).toISOString();

      // One scope predicate, applied to both sides: org rows, plus the owner's
      // legacy pre-org rows (org_id null).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scoped = <T extends { gte: (...a: any[]) => any }>(qb: T) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = qb.gte("started_at", fromIso).lt("started_at", toIso);
        q = org.ownerId
          ? q.or(`org_id.eq.${org.id},and(owner_id.eq.${org.ownerId},org_id.is.null)`)
          : q.eq("org_id", org.id);
        return q;
      };

      // WHAT THIS AUDITS, and why it changed.
      //
      // It used to compare app_metrics_summary against a head count. No screen
      // reads that RPC — every shipped number comes from getReportingData
      // (src/lib/db/metrics.ts) — so agreement proved nothing about anything a
      // user sees, and the audit_log entry recorded assurance nobody had.
      //
      // The invariant that IS load-bearing spans SQL and JS: "connected" is
      // defined twice, once as a PostgREST filter string (connectedRecordFilter,
      // used for every count the database performs) and once as a predicate
      // (isConnectedRecord, used for every count performed over fetched rows).
      // tests/metric-registry.test.ts already proves they agree over every
      // synthetic combination; nothing has ever checked them against the shapes
      // real data actually takes. A divergence silently corrupts every connect
      // rate in the product, on every screen, in the same direction.
      const { count: filterConnected, error: filterErr } = await scoped(
        admin.from("call_records").select("id", { count: "exact", head: true }),
      ).or(connectedRecordFilter());
      if (filterErr) throw new Error(filterErr.message);

      // The same rows, judged by the JS predicate. Paged, because this one
      // cannot be a head count — it has to see each row.
      let predicateConnected = 0;
      for (let from = 0; ; from += 1000) {
        const { data: page, error: pageErr } = await scoped(
          admin.from("call_records").select("outcome,human_connected"),
        ).range(from, from + 999);
        if (pageErr) throw new Error(pageErr.message);
        const rows = (page ?? []) as { outcome: string | null; human_connected: boolean | null }[];
        for (const r of rows) {
          if (isConnectedRecord({ outcome: r.outcome, humanConnected: r.human_connected })) {
            predicateConnected += 1;
          }
        }
        if (rows.length < 1000) break;
      }

      checked++;
      if ((filterConnected ?? -1) !== predicateConnected) {
        drifts++;
        await writeAudit({
          action: "metric_drift",
          actorKind: "system",
          orgId: org.id,
          targetId: org.id,
          targetKind: "org",
          detail: {
            metric: "connected_calls",
            reason:
              "connectedRecordFilter() (SQL) and isConnectedRecord() (JS) disagree on real rows",
            day: zonedDayKey(new Date(yesterdayStartMs), tz),
            timezone: tz,
            from: fromIso,
            to: toIso,
            filterConnected: filterConnected ?? null,
            predicateConnected,
          },
        });
      }
    } catch (e) {
      errors.push(`${org.name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return {
    orgsChecked: checked,
    drifts,
    ...(errors.length ? { errors } : {}),
  };
}

// ── The route ────────────────────────────────────────────────────────────────

async function runReconcileData(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set — refusing to run reconciliation." },
      { status: 503 },
    );
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Demo / no-database mode: nothing to reconcile, nothing to crash.
  if (!isAdminConfigured()) {
    return NextResponse.json({ ok: true, skipped: "Supabase service role not configured" });
  }

  const admin = createAdminClient();
  const now = new Date();
  // Leave headroom under maxDuration so a deep backlog returns a real report
  // instead of being killed mid-write; the next tick resumes the remainder.
  const deadlineMs = now.getTime() + 50_000;

  // Each job is individually caught: one failing must not starve the others.
  let counterDrift: Record<string, unknown>;
  try {
    counterDrift = await repairAttemptCounters(admin, now);
  } catch (e) {
    counterDrift = { error: e instanceof Error ? e.message : "failed" };
  }

  let stuckAttempts: Record<string, unknown>;
  try {
    stuckAttempts = await reconcileStuckAttempts(admin, now, deadlineMs);
  } catch (e) {
    stuckAttempts = { error: e instanceof Error ? e.message : "failed" };
  }

  let metricDrift: Record<string, unknown>;
  try {
    metricDrift = await checkMetricDrift(admin, now);
  } catch (e) {
    metricDrift = { error: e instanceof Error ? e.message : "failed" };
  }

  // Phase 2 intake safety net (§7): every new lead gets an opportunity with
  // honest clocks even if an intake path forgot the fast hook. Bounded and
  // idempotent, like everything else on this tick.
  let opportunityIntake: Record<string, unknown>;
  try {
    opportunityIntake = { created: await processLeadIntake() };
  } catch (e) {
    opportunityIntake = { error: e instanceof Error ? e.message : "failed" };
  }

  // Zeros included on purpose: the counters double as proof the job ran.
  count("reconcile.counter_repairs", Number(counterDrift.repaired ?? 0));
  count("reconcile.stuck_reconciled", Number(stuckAttempts.reconciled ?? 0));
  count("reconcile.metric_drift", Number(metricDrift.drifts ?? 0));
  count("reconcile.opportunities_created", Number(opportunityIntake.created ?? 0));

  return NextResponse.json({
    ok: true,
    ranAt: now.toISOString(),
    counterDrift,
    stuckAttempts,
    metricDrift,
    opportunityIntake,
  });
}

// pg_cron POSTs via app_fire_cron; support GET for manual checks / Vercel Cron.
export const GET = runReconcileData;
export const POST = runReconcileData;
