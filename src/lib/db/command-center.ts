import "server-only";

import { CONNECTED_OUTCOMES } from "../call-analytics";
import { zonedDayStartMs } from "../dialer/schedule";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Command Center (P2.10): the supervisor's org-wide cockpit. Every number is
// org-scoped, today-windowed (org timezone) unless stated otherwise on the
// surface — the metric-definition rule: no number renders without its scope
// and window. Reads only; the queues it surfaces link to the working pages.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

/** PostgREST's per-response ceiling. */
const PAGE = 1000;
/** Row-scan bound for the per-rep breakdown (12 pages = 12,000 calls/day). */
const SCAN_PAGES = 12;
/** Conversation-grade outcomes, as a PostgREST in() list. */
const CONNECTED_LIST = `(${[...CONNECTED_OUTCOMES].join(",")})`;

export interface LeakRow {
  id: string;
  leadId: string | null;
  leadName: string;
  stage: string;
  ownerName: string;
  lastTouchedAt: string | null;
}

export interface RepToday {
  id: string;
  name: string;
  dials: number;
  conversations: number;
  appointments: number;
}

export interface PlaybookSummary {
  id: string;
  name: string;
  status: string;
  version: number;
  activeInstances: number;
}

export interface CommandCenterData {
  today: {
    dials: number;
    conversations: number;
    appointments: number;
    leadsWorked: number;
    newLeads: number;
    /** Median minutes from received → first attempt, for opportunities first
     *  attempted today. Null = no valid denominator ("not enough data"). */
    speedToLeadMin: number | null;
  };
  /** True when today's call volume exceeded the row-scan bound — the three
   *  headline counts stay exact (COUNT queries), but the per-rep table and
   *  "leads worked" are computed from the scanned window and say so. */
  scanCapped: boolean;
  queues: {
    overdueCallbacks: number;
    unscheduledCallbacks: number;
    untouchedNew: number;
    hotSignals: number;
  };
  leaks: { count: number; sample: LeakRow[] };
  reps: RepToday[];
  playbooks: PlaybookSummary[];
}

export async function getCommandCenter(input: {
  orgId: string;
  orgTz: string;
}): Promise<CommandCenterData | null> {
  // Degrade to the page's empty state rather than 500ing the floor view.
  try {
    return await readCommandCenter(input);
  } catch {
    return null;
  }
}

async function readCommandCenter(input: {
  orgId: string;
  orgTz: string;
}): Promise<CommandCenterData | null> {
  if (!isAdminConfigured() || !input.orgId) return null;
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();
  const todayStartIso = new Date(zonedDayStartMs(Date.now(), input.orgTz)).toISOString();

  // Headline counts: head+exact COUNT queries, immune to any row cap.
  const callsToday = () =>
    admin
      .from("call_records")
      .select("id", { count: "exact", head: true })
      .eq("org_id", input.orgId)
      .gte("started_at", todayStartIso);

  const [dialsRes, convosRes, apptCountRes] = await Promise.all([
    callsToday(),
    callsToday().or(`human_connected.is.true,outcome.in.${CONNECTED_LIST}`),
    callsToday().eq("outcome", "appointment_booked"),
  ]);

  // Per-rep breakdown needs the rows themselves (PostgREST can't GROUP BY),
  // so it pages within a bound and reports honestly when it hits it.
  const calls: Row[] = [];
  let scanCapped = false;
  for (let page = 0; page < SCAN_PAGES; page++) {
    const { data, error } = await admin
      .from("call_records")
      .select("owner_id, lead_id, outcome, human_connected")
      .eq("org_id", input.orgId)
      .gte("started_at", todayStartIso)
      .order("started_at", { ascending: true })
      .order("id", { ascending: true })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as Row[];
    calls.push(...rows);
    if (rows.length < PAGE) break;
    if (page === SCAN_PAGES - 1) scanCapped = true;
  }

  const [
    newLeadsRes,
    untouchedRes,
    overdueCbRes,
    unschedCbRes,
    hotSigRes,
    leaksRes,
    playbooksRes,
    instancesRes,
    sttRes,
    membersRes,
  ] = await Promise.all([
    admin
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("org_id", input.orgId)
      .is("archived_at", null)
      .gte("created_at", todayStartIso),
    admin
      .from("opportunities")
      .select("id", { count: "exact", head: true })
      .eq("org_id", input.orgId)
      .eq("op_status", "open")
      .in("stage", ["new", "assigned"])
      .eq("attempt_count", 0),
    admin
      .from("callbacks")
      .select("id", { count: "exact", head: true })
      .eq("org_id", input.orgId)
      .not("status", "in", '("completed","cancelled")')
      .lte("due_at", nowIso),
    admin
      .from("callbacks")
      .select("id", { count: "exact", head: true })
      .eq("org_id", input.orgId)
      .not("status", "in", '("completed","cancelled")')
      .is("due_at", null),
    admin
      .from("signals")
      .select("id", { count: "exact", head: true })
      .eq("org_id", input.orgId)
      .is("resolved_at", null)
      .gte("severity", 4)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`),
    // Leaks = work that WAS in motion and stalled. Never-attempted leads are
    // excluded on purpose: they are already the "untouched new" queue above,
    // and counting the same backlog in two panels is how a supervisor ends up
    // with two numbers describing one problem. attempt_count > 0 is the line.
    admin
      .rpc("app_pipeline_leaks", { p_org: input.orgId }, { count: "exact" })
      .select("id, lead_id, stage, owner_id, last_touched_at")
      .gt("attempt_count", 0)
      .order("last_touched_at", { ascending: true, nullsFirst: false })
      .limit(8),
    admin
      .from("playbooks")
      .select("id, name, status, version")
      .eq("org_id", input.orgId)
      .neq("status", "retired")
      .order("name", { ascending: true })
      .limit(20),
    admin
      .from("playbook_instances")
      .select("playbook_id")
      .eq("org_id", input.orgId)
      .in("status", ["active", "waiting"])
      .limit(2000),
    admin
      .from("opportunities")
      .select("first_received_at, first_attempted_at")
      .eq("org_id", input.orgId)
      .gte("first_attempted_at", todayStartIso)
      .not("first_received_at", "is", null)
      .limit(1000),
    admin
      .from("organization_members")
      .select("user_id, name")
      .eq("org_id", input.orgId),
  ]);

  // ── Today strip ────────────────────────────────────────────────────────────
  const isConversation = (r: Row) =>
    r.human_connected === true || (CONNECTED_OUTCOMES as Set<string>).has(s(r.outcome));
  const today = {
    dials: dialsRes.count ?? 0,
    conversations: convosRes.count ?? 0,
    appointments: apptCountRes.count ?? 0,
    // Distinct-count isn't expressible in PostgREST — this one rides the
    // bounded scan and is labeled when the scan capped.
    leadsWorked: new Set(calls.map((r) => s(r.lead_id)).filter(Boolean)).size,
    newLeads: newLeadsRes.count ?? 0,
    speedToLeadMin: null as number | null,
  };
  const sttRows = ((sttRes.data ?? []) as Row[])
    .map((r) => {
      const received = Date.parse(s(r.first_received_at));
      const attempted = Date.parse(s(r.first_attempted_at));
      return Number.isFinite(received) && Number.isFinite(attempted) && attempted >= received
        ? (attempted - received) / 60_000
        : null;
    })
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  // minDenominator rule: below 3 samples the median is noise, not a metric.
  if (sttRows.length >= 3) {
    today.speedToLeadMin = Math.round(sttRows[Math.floor(sttRows.length / 2)]);
  }

  // ── Attention queues ───────────────────────────────────────────────────────
  const queues = {
    overdueCallbacks: overdueCbRes.count ?? 0,
    unscheduledCallbacks: unschedCbRes.count ?? 0,
    untouchedNew: untouchedRes.count ?? 0,
    hotSignals: hotSigRes.count ?? 0,
  };

  // ── Pipeline leaks (sample + true count) ───────────────────────────────────
  const names = new Map(
    ((membersRes.data ?? []) as Row[]).map((m) => [s(m.user_id), s(m.name)]),
  );
  const leakRows = (leaksRes.data ?? []) as Row[];
  const leakLeadIds = [...new Set(leakRows.map((r) => s(r.lead_id)).filter(Boolean))];
  const leadNames = new Map<string, string>();
  if (leakLeadIds.length) {
    const { data: ll } = await admin
      .from("leads")
      .select("id, first_name, last_name")
      .in("id", leakLeadIds);
    for (const l of (ll ?? []) as Row[]) {
      leadNames.set(s(l.id), [s(l.first_name), s(l.last_name)].filter(Boolean).join(" "));
    }
  }
  const leaks = {
    count: leaksRes.count ?? leakRows.length,
    sample: leakRows.map(
      (r): LeakRow => ({
        id: s(r.id),
        leadId: r.lead_id ? s(r.lead_id) : null,
        leadName: leadNames.get(s(r.lead_id)) || "—",
        stage: s(r.stage),
        ownerName: names.get(s(r.owner_id)) || "Unassigned",
        lastTouchedAt: r.last_touched_at ? s(r.last_touched_at) : null,
      }),
    ),
  };

  // ── Rep performance (today) ────────────────────────────────────────────────
  const byRep = new Map<string, RepToday>();
  for (const r of calls) {
    const id = s(r.owner_id);
    if (!id) continue;
    const rep =
      byRep.get(id) ??
      ({ id, name: names.get(id) || "Rep", dials: 0, conversations: 0, appointments: 0 } as RepToday);
    rep.dials += 1;
    if (isConversation(r)) rep.conversations += 1;
    if (s(r.outcome) === "appointment_booked") rep.appointments += 1;
    byRep.set(id, rep);
  }
  const reps = [...byRep.values()].sort(
    (a, b) => b.conversations - a.conversations || b.dials - a.dials,
  );

  // ── Playbooks ──────────────────────────────────────────────────────────────
  const instanceCounts = new Map<string, number>();
  for (const i of (instancesRes.data ?? []) as Row[]) {
    const id = s(i.playbook_id);
    instanceCounts.set(id, (instanceCounts.get(id) ?? 0) + 1);
  }
  const playbooks = ((playbooksRes.data ?? []) as Row[]).map(
    (p): PlaybookSummary => ({
      id: s(p.id),
      name: s(p.name),
      status: s(p.status),
      version: n(p.version) || 1,
      activeInstances: instanceCounts.get(s(p.id)) ?? 0,
    }),
  );

  return { today, scanCapped, queues, leaks, reps, playbooks };
}
