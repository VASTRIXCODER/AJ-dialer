import "server-only";

import { CONNECTED_OUTCOMES } from "../call-analytics";
import {
  isWithinOrgHours,
  zonedDayKey,
  zonedDayStartMs,
  zonedFloatingNow,
  type OrgHours,
} from "../dialer/schedule";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { getMyAssignments } from "./assignments";
import { getDncDigits, dncKey } from "./dnc";
import type { Scope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// My Day (P2.6): one read that answers "what should I do right now" for the
// signed-in rep. Everything is fenced to the viewer — this page is personal
// by design (supervisors get the org view on the command center instead).
//
// The who-next ladder is DETERMINISTIC and hard-filtered: it may never
// recommend a DNC'd, archived, number-less, out-of-window, or
// someone-else-holds-it lead. A recommendation that breaks a rule teaches the
// rep to ignore recommendations.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

export interface MyDayCallback {
  id: string;
  leadId: string | null;
  name: string;
  phone: string;
  dueAt: string | null;
  reason: string;
}

export interface MyDayWorkItem {
  id: string;
  leadId: string | null;
  type: string;
  reason: string;
  dueAt: string | null;
}

export interface MyDaySignal {
  id: string;
  leadId: string | null;
  type: string;
  severity: number;
  reason: string;
  detectedAt: string;
  leadName: string;
}

export interface MyDayAppointment {
  id: string;
  leadId: string | null;
  name: string;
  scheduledAt: string | null;
  scheduledLabel: string;
  status: string;
}

export interface WhoNext {
  leadId: string;
  name: string;
  phone: string;
  reason: string;
  source: "callback" | "signal" | "work_item";
  /**
   * When the recommendation came from a promised callback, its id — deep-linked
   * into the dialer so filing the disposition CLOSES the callback (the same
   * contract the callbacks board relies on). Without it the promise stays open
   * and this rep gets recommended the same person forever.
   */
  callbackId: string | null;
}

export interface MyDayData {
  callbacks: {
    overdue: number;
    dueToday: number;
    unscheduled: number;
    items: MyDayCallback[];
  };
  workItems: { open: number; items: MyDayWorkItem[] };
  signals: MyDaySignal[];
  appointmentsToday: { count: number; items: MyDayAppointment[] };
  /** Self scope, org-timezone "today". */
  today: { dials: number; conversations: number; appointments: number; talkSec: number };
  assignments: { id: string; label: string; worked: number; total: number }[];
  whoNext: WhoNext | null;
  /**
   * "Now" as a floating wall clock in the org's zone. The page renders callback
   * and appointment times against THIS, not against a real UTC instant — those
   * columns store offset-less wall clocks (see floatingRelativeTime).
   */
  nowFloating: string;
}

export async function getMyDay(input: {
  scope: Scope;
  hours: OrgHours | null;
  orgTz: string;
}): Promise<MyDayData | null> {
  // A transient DB hiccup must degrade to the page's empty state, never 500 a
  // rep's first screen of the day — the idiom every other db module follows.
  try {
    return await readMyDay(input);
  } catch {
    return null;
  }
}

async function readMyDay(input: {
  scope: Scope;
  hours: OrgHours | null;
  orgTz: string;
}): Promise<MyDayData | null> {
  const { scope, hours, orgTz } = input;
  if (!isAdminConfigured() || !scope.orgId) return null;
  const admin = createAdminClient();
  const now = new Date();
  const nowIso = now.toISOString();
  // Floating-timestamp day window (callbacks/appointments store agreed
  // wall-clock times as-is — the Phase 1 convention).
  const dayKey = zonedDayKey(now, orgTz);
  // The next calendar day is derived from the date STRING, not from now+24h:
  // on a DST fall-back day the zone has 25 hours, so +24h can still land on
  // the same local date and collapse the day window to zero width.
  const nextDayKey = new Date(Date.parse(`${dayKey}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const dayStart = `${dayKey}T00:00:00`;
  const dayEnd = `${nextDayKey}T00:00:00`;
  // "Now" in the SAME frame as those bounds. callbacks.due_at and
  // appointments.scheduled_at hold offset-less wall-clock strings, so the only
  // correct comparison is floating-against-floating; using the real UTC instant
  // here reads a 5pm promise as overdue from midday (and, after the day's UTC
  // rollover, makes the "due later today" range empty every evening).
  const floatingNow = zonedFloatingNow(now, orgTz);
  // Real-UTC day bound for call_records.started_at.
  const todayStartIso = new Date(zonedDayStartMs(now.getTime(), orgTz)).toISOString();

  const mineCallback = `assigned_to.eq.${scope.userId},and(assigned_to.is.null,owner_id.eq.${scope.userId})`;

  // Counts come from head+exact COUNT queries, NEVER from the length of a
  // fetched page — PostgREST caps arrays at 1,000 rows, and a count that
  // silently saturates is exactly the class of bug the session builder was
  // fixed for. The row fetch below exists only to LIST the first few.
  const openMine = () =>
    admin
      .from("callbacks")
      .select("id", { count: "exact", head: true })
      .eq("org_id", scope.orgId as string)
      .not("status", "in", '("completed","cancelled")')
      .or(mineCallback);

  // Same rule for today's own numbers: COUNT queries, not array lengths. A
  // long 3-line parallel session can approach any row bound worth setting.
  const myCallsToday = () =>
    admin
      .from("call_records")
      .select("id", { count: "exact", head: true })
      .eq("org_id", scope.orgId as string)
      .eq("owner_id", scope.userId)
      .gte("started_at", todayStartIso);

  const [cbOverdueRes, cbTodayRes, cbUnschedRes, dialsRes, convosRes, apptDoneRes] =
    await Promise.all([
      openMine().lte("due_at", floatingNow),
      openMine().gt("due_at", floatingNow).lt("due_at", dayEnd),
      openMine().is("due_at", null),
      myCallsToday(),
      myCallsToday().or(
        `human_connected.is.true,outcome.in.(${[...CONNECTED_OUTCOMES].join(",")})`,
      ),
      myCallsToday().eq("outcome", "appointment_booked"),
    ]);

  // The other two headline counts, for the same reason: a page limit is not a
  // total, and "+N more open tasks" derived from a saturated value lies twice.
  const [openWorkRes, apptTodayRes] = await Promise.all([
    admin
      .from("work_items")
      .select("id", { count: "exact", head: true })
      .eq("org_id", scope.orgId)
      .in("status", ["pending", "reserved", "in_progress", "waiting"])
      .or(`owner_id.eq.${scope.userId},reserved_by.eq.${scope.userId}`),
    admin
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("org_id", scope.orgId)
      .neq("status", "cancelled")
      .or(mineCallback)
      .gte("scheduled_at", dayStart)
      .lt("scheduled_at", dayEnd),
  ]);

  const [cbRes, wiRes, sigRes, apptRes, callsRes, assignments] = await Promise.all([
    admin
      .from("callbacks")
      .select("id, lead_id, lead_name, phone, due_at, reason, status")
      .eq("org_id", scope.orgId)
      .not("status", "in", '("completed","cancelled")')
      .or(mineCallback)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(100),
    admin
      .from("work_items")
      .select("id, lead_id, type, reason, due_at, status, priority")
      .eq("org_id", scope.orgId)
      .in("status", ["pending", "reserved", "in_progress", "waiting"])
      .or(`owner_id.eq.${scope.userId},reserved_by.eq.${scope.userId}`)
      // Priority first — a playbook that marks an item "hot" (95) means it,
      // and ordering by date alone put it behind older routine work.
      .order("priority", { ascending: false })
      .order("due_at", { ascending: true, nullsFirst: true })
      .limit(50),
    admin
      .from("signals")
      .select("id, lead_id, opportunity_id, type, severity, evidence, detected_at, audience")
      .eq("org_id", scope.orgId)
      .is("resolved_at", null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("severity", { ascending: false })
      .order("detected_at", { ascending: false })
      // Ownership can only be resolved through opportunities (signals carry no
      // owner column), so the filter happens after the fetch. The page is
      // therefore generous: a small page could be entirely other reps' signals
      // and leave this rep seeing none of their own.
      .limit(200),
    admin
      .from("appointments")
      .select("id, lead_id, lead_name, scheduled_at, scheduled_label, status")
      .eq("org_id", scope.orgId)
      .neq("status", "cancelled")
      .or(mineCallback)
      .gte("scheduled_at", dayStart)
      .lt("scheduled_at", dayEnd)
      .order("scheduled_at", { ascending: true })
      .limit(50),
    admin
      .from("call_records")
      .select("talk_sec")
      .eq("org_id", scope.orgId)
      .eq("owner_id", scope.userId)
      .gte("started_at", todayStartIso)
      .limit(2000),
    getMyAssignments(scope.userId, scope.orgId),
  ]);

  const cbRows = (cbRes.data ?? []) as Row[];
  const callbacks = {
    overdue: cbOverdueRes.count ?? 0,
    dueToday: cbTodayRes.count ?? 0,
    // The spec's rule: an item with no time is UNSCHEDULED, never "due now".
    unscheduled: cbUnschedRes.count ?? 0,
    items: cbRows.slice(0, 5).map(
      (r): MyDayCallback => ({
        id: s(r.id),
        leadId: r.lead_id ? s(r.lead_id) : null,
        name: s(r.lead_name),
        phone: s(r.phone),
        dueAt: r.due_at ? s(r.due_at) : null,
        reason: s(r.reason),
      }),
    ),
  };

  const wiRows = (wiRes.data ?? []) as Row[];
  const workItems = {
    open: openWorkRes.count ?? wiRows.length,
    items: wiRows.slice(0, 5).map(
      (r): MyDayWorkItem => ({
        id: s(r.id),
        leadId: r.lead_id ? s(r.lead_id) : null,
        type: s(r.type),
        reason: s(r.reason),
        dueAt: r.due_at ? s(r.due_at) : null,
      }),
    ),
  };

  // Signals: reps see only signals on opportunities they own (or unowned).
  const sigRaw = (sigRes.data ?? []) as Row[];
  const sigOppIds = [
    ...new Set(sigRaw.map((r) => s(r.opportunity_id)).filter(Boolean)),
  ];
  let ownedOpp = new Map<string, string | null>();
  if (sigOppIds.length) {
    const { data: opps } = await admin
      .from("opportunities")
      .select("id, owner_id")
      .in("id", sigOppIds);
    ownedOpp = new Map(
      ((opps ?? []) as Row[]).map((o) => [s(o.id), o.owner_id ? s(o.owner_id) : null]),
    );
  }
  const mySignals = sigRaw.filter((r) => {
    if (scope.supervisor) return true;
    // Manager-audience rungs belong to supervisors — see /api/signals.
    if (s(r.audience) && s(r.audience) !== "owner") return false;
    const owner = ownedOpp.get(s(r.opportunity_id));
    return !owner || owner === scope.userId;
  });
  const sigLeadIds = [...new Set(mySignals.map((r) => s(r.lead_id)).filter(Boolean))];
  const leadNames = new Map<string, string>();
  if (sigLeadIds.length) {
    const { data: sl } = await admin
      .from("leads")
      .select("id, first_name, last_name")
      .in("id", sigLeadIds.slice(0, 25));
    for (const l of (sl ?? []) as Row[]) {
      leadNames.set(s(l.id), [s(l.first_name), s(l.last_name)].filter(Boolean).join(" "));
    }
  }
  const signals = mySignals.slice(0, 5).map(
    (r): MyDaySignal => ({
      id: s(r.id),
      leadId: r.lead_id ? s(r.lead_id) : null,
      type: s(r.type),
      severity: n(r.severity) || 3,
      reason: s((r.evidence as Row | null)?.reason ?? ""),
      detectedAt: s(r.detected_at),
      leadName: leadNames.get(s(r.lead_id)) || "",
    }),
  );

  const apptRows = (apptRes.data ?? []) as Row[];
  const appointmentsToday = {
    count: apptTodayRes.count ?? apptRows.length,
    items: apptRows.slice(0, 5).map(
      (r): MyDayAppointment => ({
        id: s(r.id),
        leadId: r.lead_id ? s(r.lead_id) : null,
        name: s(r.lead_name),
        scheduledAt: r.scheduled_at ? s(r.scheduled_at) : null,
        scheduledLabel: s(r.scheduled_label),
        status: s(r.status),
      }),
    ),
  };

  // Counts are exact (COUNT queries above); talk time is a SUM that PostgREST
  // can't express, so it rides the row fetch — under-reporting only in the
  // physically implausible case of one rep placing 2,000+ calls in a day.
  const callRows = (callsRes.data ?? []) as Row[];
  const today = {
    dials: dialsRes.count ?? 0,
    conversations: convosRes.count ?? 0,
    appointments: apptDoneRes.count ?? 0,
    talkSec: callRows.reduce((sum, r) => sum + n(r.talk_sec), 0),
  };

  const myAssignments = assignments
    .filter((a) => a.status === "active")
    .slice(0, 3)
    .map((a) => ({
      id: a.id,
      label: a.label,
      worked: Math.max(0, a.progress.total - a.progress.untouched),
      total: a.progress.total,
    }));

  // ── Who should I call next? ────────────────────────────────────────────────
  // Ladder: overdue callback → hot signal → due work item → callback due today.
  // Every candidate is verified against the hard rules before it may win.
  interface Candidate {
    leadId: string;
    reason: string;
    source: WhoNext["source"];
    callbackId: string | null;
  }
  const candidates: Candidate[] = [];
  for (const r of cbRows.filter((r) => r.lead_id && r.due_at && s(r.due_at) <= floatingNow)) {
    candidates.push({
      leadId: s(r.lead_id),
      reason: "You promised this call back — it's due now.",
      source: "callback",
      callbackId: s(r.id) || null,
    });
  }
  for (const sig of signals.filter((x) => x.severity >= 4 && x.leadId)) {
    candidates.push({
      leadId: sig.leadId as string,
      reason: sig.reason || `Hot signal: ${sig.type.replace(/_/g, " ")}.`,
      source: "signal",
      callbackId: null,
    });
  }
  for (const w of wiRows.filter(
    (r) => r.lead_id && (!r.due_at || s(r.due_at) <= nowIso),
  )) {
    candidates.push({
      leadId: s(w.lead_id),
      reason: s(w.reason) || "An open task points here.",
      source: "work_item",
      callbackId: null,
    });
  }
  for (const r of cbRows.filter(
    (r) => r.lead_id && r.due_at && s(r.due_at) > floatingNow && s(r.due_at) < dayEnd,
  )) {
    candidates.push({
      leadId: s(r.lead_id),
      reason: "Callback promised for later today.",
      source: "callback",
      callbackId: s(r.id) || null,
    });
  }

  let whoNext: WhoNext | null = null;
  if (candidates.length) {
    const seen = new Set<string>();
    const ordered = candidates.filter((c) => {
      if (seen.has(c.leadId)) return false;
      seen.add(c.leadId);
      return true;
    });
    const ids = ordered.slice(0, 8).map((c) => c.leadId);
    const [{ data: leadRows }, dnc] = await Promise.all([
      admin
        .from("leads")
        .select(
          "id, org_id, status, phone, timezone, archived_at, reserved_by, reserved_until, first_name, last_name",
        )
        .in("id", ids),
      getDncDigits(scope.orgId),
    ]);
    const byId = new Map(((leadRows ?? []) as Row[]).map((l) => [s(l.id), l]));
    for (const c of ordered) {
      const lead = byId.get(c.leadId);
      if (!lead) continue;
      if (s(lead.org_id) !== scope.orgId) continue;
      if (lead.archived_at) continue;
      if (s(lead.status) === "dnc") continue;
      const phone = s(lead.phone);
      if (phone.replace(/\D/g, "").length < 10) continue;
      if (dnc.has(dncKey(phone))) continue;
      // Someone else is actively holding this lead right now.
      if (
        lead.reserved_by &&
        s(lead.reserved_by) !== scope.userId &&
        lead.reserved_until &&
        s(lead.reserved_until) > nowIso
      ) {
        continue;
      }
      // Never recommend a call the calling-hours policy would flag — judged in
      // the LEAD's timezone when it has one.
      if (!isWithinOrgHours(now, hours, s(lead.timezone) || orgTz)) continue;
      whoNext = {
        leadId: c.leadId,
        name:
          [s(lead.first_name), s(lead.last_name)].filter(Boolean).join(" ") || phone,
        phone,
        reason: c.reason,
        source: c.source,
        callbackId: c.callbackId,
      };
      break;
    }
  }

  return {
    callbacks,
    workItems,
    signals,
    appointmentsToday,
    today,
    assignments: myAssignments,
    whoNext,
    nowFloating: floatingNow,
  };
}
