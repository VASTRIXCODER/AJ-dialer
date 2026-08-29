import { NextResponse } from "next/server";
import { getScopedLeadRow } from "@/lib/db/lead-360";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Everything the automation did to one record.
//
// Four append-only logs that nothing has ever rendered: the opportunity's own
// stage history, the playbook runs against it, the work items it produced, and
// the signals it raised. All of it has been accumulating since PART 37 with no
// reader, which is why "why did this record get escalated?" has had no answer.
//
// Its own endpoint rather than a slice of the panel: the panel is re-read every
// 20 seconds by the open drawer, and this is five more queries whose answers
// change on the order of hours. It loads when the tab is opened.
//
// Authorization REUSES getScopedLeadRow — the same fence as the panel and the
// timeline, so the three can never disagree about who may see a record.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

const EVENT_LIMIT = 40;
const RUN_LIMIT = 10;
const STEP_LIMIT = 60;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params;

  const access = await getScopedLeadRow(leadId);
  if (!access.ok) {
    // Same information boundary as the panel: "denied" only for a record inside
    // the viewer's own org, so a foreign id can't be confirmed to exist.
    return NextResponse.json(
      { error: access.reason },
      { status: access.reason === "unauthenticated" ? 401 : access.reason === "denied" ? 403 : 404 },
    );
  }
  const { scope } = access;

  const rl = rateLimit(`lead-automation:${scope.userId}`, 120, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // PART 37 may not be applied on an environment; that reads as "no automation
  // history", not as an error the rep has to think about.
  if (!isAdminConfigured() || !scope.orgId) {
    return NextResponse.json(emptyPayload());
  }

  try {
    const admin = createAdminClient();
    const { data: opp } = await admin
      .from("opportunities")
      .select("id")
      .eq("org_id", scope.orgId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const opportunityId = opp ? s(opp.id) : "";

    const [eventsRes, instRes, itemsRes, signalsRes] = await Promise.all([
      opportunityId
        ? admin
            .from("opportunity_events")
            .select("id, type, actor_kind, actor_id, from_stage, to_stage, detail, created_at")
            .eq("org_id", scope.orgId)
            .eq("opportunity_id", opportunityId)
            .order("created_at", { ascending: false })
            .limit(EVENT_LIMIT)
        : Promise.resolve({ data: [] as Row[] }),
      opportunityId
        ? admin
            .from("playbook_instances")
            .select(
              "id, playbook_id, playbook_version, status, current_step, stopped_reason, started_at, ended_at",
            )
            .eq("org_id", scope.orgId)
            .eq("opportunity_id", opportunityId)
            .order("started_at", { ascending: false })
            .limit(RUN_LIMIT)
        : Promise.resolve({ data: [] as Row[] }),
      admin
        .from("work_items")
        .select(
          "id, type, reason, status, priority, due_at, queue, created_at, completed_at, reserved_until",
        )
        .eq("org_id", scope.orgId)
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(25),
      admin
        .from("signals")
        .select(
          "id, type, severity, evidence, audience, detected_at, resolved_at, resolution, acknowledged_at",
        )
        .eq("org_id", scope.orgId)
        .eq("lead_id", leadId)
        .order("detected_at", { ascending: false })
        .limit(25),
    ]);

    const instances = (instRes.data ?? []) as Row[];
    const instanceIds = instances.map((i) => s(i.id)).filter(Boolean);
    const playbookIds = [...new Set(instances.map((i) => s(i.playbook_id)).filter(Boolean))];
    const actorIds = [
      ...new Set(
        ((eventsRes.data ?? []) as Row[]).map((e) => s(e.actor_id)).filter(Boolean),
      ),
    ];

    const [stepsRes, namesRes, membersRes] = await Promise.all([
      instanceIds.length
        ? admin
            .from("playbook_executions")
            .select("id, instance_id, step_index, action_kind, status, detail, error, executed_at")
            .in("instance_id", instanceIds)
            .order("executed_at", { ascending: true })
            .limit(STEP_LIMIT)
        : Promise.resolve({ data: [] as Row[] }),
      playbookIds.length
        ? admin.from("playbooks").select("id, name").in("id", playbookIds)
        : Promise.resolve({ data: [] as Row[] }),
      actorIds.length
        ? admin
            .from("organization_members")
            .select("user_id, name")
            .eq("org_id", scope.orgId)
            .in("user_id", actorIds)
        : Promise.resolve({ data: [] as Row[] }),
    ]);

    const names = new Map(
      ((namesRes.data ?? []) as Row[]).map((p) => [s(p.id), s(p.name)]),
    );
    const actors = new Map(
      ((membersRes.data ?? []) as Row[]).map((m) => [s(m.user_id), s(m.name)]),
    );
    const stepsByInstance = new Map<string, Row[]>();
    for (const st of (stepsRes.data ?? []) as Row[]) {
      const key = s(st.instance_id);
      const list = stepsByInstance.get(key) ?? [];
      list.push(st);
      stepsByInstance.set(key, list);
    }

    return NextResponse.json({
      events: ((eventsRes.data ?? []) as Row[]).map((e) => ({
        id: s(e.id),
        type: s(e.type),
        actorKind: s(e.actor_kind),
        // A named human when there is one; the copy layer falls back to a role.
        actorName: actors.get(s(e.actor_id)) || null,
        fromStage: e.from_stage ? s(e.from_stage) : null,
        toStage: e.to_stage ? s(e.to_stage) : null,
        detail: (e.detail ?? {}) as Record<string, unknown>,
        at: s(e.created_at),
      })),
      runs: instances.map((i) => ({
        id: s(i.id),
        name: names.get(s(i.playbook_id)) || "Playbook",
        version: n(i.playbook_version),
        status: s(i.status),
        currentStep: n(i.current_step),
        stoppedReason: i.stopped_reason ? s(i.stopped_reason) : null,
        startedAt: s(i.started_at),
        endedAt: i.ended_at ? s(i.ended_at) : null,
        steps: (stepsByInstance.get(s(i.id)) ?? []).map((st) => ({
          id: s(st.id),
          stepIndex: n(st.step_index),
          actionKind: s(st.action_kind),
          status: s(st.status),
          detail: (st.detail ?? {}) as Record<string, unknown>,
          error: st.error ? s(st.error) : null,
          at: s(st.executed_at),
        })),
      })),
      workItems: ((itemsRes.data ?? []) as Row[]).map((w) => ({
        id: s(w.id),
        type: s(w.type),
        reason: s(w.reason),
        status: s(w.status),
        priority: n(w.priority),
        queue: w.queue ? s(w.queue) : null,
        dueAt: w.due_at ? s(w.due_at) : null,
        createdAt: s(w.created_at),
        completedAt: w.completed_at ? s(w.completed_at) : null,
      })),
      signals: ((signalsRes.data ?? []) as Row[]).map((sig) => ({
        id: s(sig.id),
        type: s(sig.type),
        severity: n(sig.severity) || 3,
        reason: s((sig.evidence as Row | null)?.reason ?? ""),
        audience: s(sig.audience) || "owner",
        detectedAt: s(sig.detected_at),
        resolvedAt: sig.resolved_at ? s(sig.resolved_at) : null,
        resolution: sig.resolution ? s(sig.resolution) : null,
        acknowledged: Boolean(sig.acknowledged_at),
      })),
    });
  } catch {
    // A missing table or a transient failure reads as "no history", never a 500
    // in a drawer the rep has open mid-call.
    return NextResponse.json(emptyPayload());
  }
}

function emptyPayload() {
  return { events: [], runs: [], workItems: [], signals: [] };
}
