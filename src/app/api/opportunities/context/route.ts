import { NextResponse } from "next/server";
import { getScope, canActOn } from "@/lib/db/scope";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Pre-call context (P2.3): everything the dialer's "why this person now" brief
// needs, in one read — the open opportunity's stage/clocks/next action, the
// open work items behind the dial, live signals, and any running playbooks.
// `context: null` is a NORMAL answer (demo mode, PART 37 absent, no
// opportunity) — the card simply doesn't render.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export async function GET(req: Request) {
  const scope = await getScope();
  if (!scope?.orgId || !isAdminConfigured()) {
    return NextResponse.json({ context: null });
  }
  const rl = rateLimit(`opp-context:${scope.userId}`, 240, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  const leadId = new URL(req.url).searchParams.get("leadId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) {
    return NextResponse.json({ context: null });
  }

  const admin = createAdminClient();

  // Ownership fence: the lead must be in the viewer's org, and a rep must own
  // it (owner or assigned) — a supervisor may read any org lead's context.
  const { data: lead } = await admin
    .from("leads")
    .select("id, org_id, owner_id, assigned_rep_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ context: null });
  const leadOrg = lead.org_id ? String(lead.org_id) : null;
  const assignedToViewer = s(lead.assigned_rep_id) === scope.userId;
  if (
    !canActOn(scope, lead.owner_id ? String(lead.owner_id) : null, leadOrg) &&
    !(assignedToViewer && leadOrg === scope.orgId)
  ) {
    return NextResponse.json({ context: null });
  }

  const { data: opp } = await admin
    .from("opportunities")
    .select(
      "id, stage, op_status, priority, priority_reason, hot_until, attempt_count, contact_count, first_received_at, last_touched_at, next_action_kind, next_action_due_at, stage_entered_at, owner_id, source",
    )
    .eq("org_id", scope.orgId)
    .eq("lead_id", leadId)
    .neq("op_status", "closed")
    .maybeSingle();
  if (!opp) return NextResponse.json({ context: null });

  const nowIso = new Date().toISOString();
  const [itemsRes, signalsRes, instRes] = await Promise.all([
    admin
      .from("work_items")
      .select("id, type, reason, due_at, priority, status")
      .eq("org_id", scope.orgId)
      .eq("lead_id", leadId)
      .in("status", ["pending", "reserved", "in_progress", "waiting"])
      .order("due_at", { ascending: true, nullsFirst: true })
      .limit(3),
    admin
      .from("signals")
      .select("id, type, severity, evidence, detected_at")
      .eq("org_id", scope.orgId)
      .eq("lead_id", leadId)
      .is("resolved_at", null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("severity", { ascending: false })
      .limit(3),
    admin
      .from("playbook_instances")
      .select("id, playbook_id, status, current_step, started_at")
      .eq("org_id", scope.orgId)
      .eq("opportunity_id", String(opp.id))
      .in("status", ["active", "waiting"])
      .limit(2),
  ]);

  // playbook_instances → playbooks name (two-step: no FK path for embedding
  // that respects the version pin, and two bounded reads are plenty here).
  const instances = (instRes.data ?? []) as Row[];
  const playbookIds = [...new Set(instances.map((i) => s(i.playbook_id)).filter(Boolean))];
  const names = new Map<string, string>();
  if (playbookIds.length) {
    const { data: pbs } = await admin
      .from("playbooks")
      .select("id, name")
      .in("id", playbookIds);
    for (const p of (pbs ?? []) as Row[]) names.set(s(p.id), s(p.name));
  }

  return NextResponse.json({
    context: {
      opportunityId: String(opp.id),
      stage: s(opp.stage),
      opStatus: s(opp.op_status),
      priority: Number(opp.priority ?? 0),
      priorityReason: opp.priority_reason ? s(opp.priority_reason) : null,
      hotUntil: opp.hot_until ? s(opp.hot_until) : null,
      attemptCount: Number(opp.attempt_count ?? 0),
      contactCount: Number(opp.contact_count ?? 0),
      firstReceivedAt: opp.first_received_at ? s(opp.first_received_at) : null,
      lastTouchedAt: opp.last_touched_at ? s(opp.last_touched_at) : null,
      stageEnteredAt: opp.stage_entered_at ? s(opp.stage_entered_at) : null,
      nextActionKind: opp.next_action_kind ? s(opp.next_action_kind) : null,
      nextActionDueAt: opp.next_action_due_at ? s(opp.next_action_due_at) : null,
      source: opp.source ? s(opp.source) : null,
      workItems: ((itemsRes.data ?? []) as Row[]).map((w) => ({
        id: s(w.id),
        type: s(w.type),
        reason: s(w.reason),
        dueAt: w.due_at ? s(w.due_at) : null,
        priority: Number(w.priority ?? 0),
        status: s(w.status),
      })),
      signals: ((signalsRes.data ?? []) as Row[]).map((sig) => ({
        id: s(sig.id),
        type: s(sig.type),
        severity: Number(sig.severity ?? 3),
        reason: s((sig.evidence as Row | null)?.reason ?? ""),
        detectedAt: s(sig.detected_at),
      })),
      playbooks: instances.map((i) => ({
        id: s(i.id),
        name: names.get(s(i.playbook_id)) || "Playbook",
        status: s(i.status),
        step: Number(i.current_step ?? 0),
        startedAt: s(i.started_at),
      })),
    },
  });
}
