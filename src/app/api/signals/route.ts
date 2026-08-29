import { NextResponse } from "next/server";
import { getScope } from "@/lib/db/scope";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Hot signals (P2.6-lite): the org's open, unexpired signals — every row
// explainable (type + evidence + freshness), acknowledgeable, dismissible.
// Reps see signals on THEIR opportunities; supervisors see the org.
// The engine's escalate steps write here; the queue is where they surface.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const scope = await getScope();
  if (!scope?.orgId || !isAdminConfigured()) {
    return NextResponse.json({ signals: [] });
  }
  const admin = createAdminClient();
  const { data } = await admin
    .from("signals")
    .select(
      "id, type, severity, evidence, detected_at, last_seen_at, seen_count, expires_at, acknowledged_at, opportunity_id, lead_id",
    )
    .eq("org_id", scope.orgId)
    .is("resolved_at", null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("severity", { ascending: false })
    .order("detected_at", { ascending: false })
    .limit(50);
  type Row = Record<string, unknown>;
  const raw = (data ?? []) as Row[];

  // signals.lead_id / opportunity_id carry no FK for PostgREST to embed on —
  // resolve names + ownership in two bounded id-list reads instead.
  const oppIds = [...new Set(raw.map((r) => String(r.opportunity_id ?? "")).filter(Boolean))];
  const leadIds = [...new Set(raw.map((r) => String(r.lead_id ?? "")).filter(Boolean))];
  const [oppRes, leadRes] = await Promise.all([
    oppIds.length
      ? admin.from("opportunities").select("id, owner_id, stage").in("id", oppIds)
      : Promise.resolve({ data: [] as Row[] }),
    leadIds.length
      ? admin.from("leads").select("id, first_name, last_name, phone").in("id", leadIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const opps = new Map(
    ((oppRes.data ?? []) as Row[]).map((o) => [String(o.id), o]),
  );
  const leads = new Map(
    ((leadRes.data ?? []) as Row[]).map((l) => [String(l.id), l]),
  );

  const rows = raw
    // Reps: only signals on opportunities they own (or unowned ones).
    .filter((r) => {
      if (scope.supervisor) return true;
      const opp = opps.get(String(r.opportunity_id ?? ""));
      return !opp?.owner_id || String(opp.owner_id) === scope.userId;
    })
    .map((r) => {
      const opp = opps.get(String(r.opportunity_id ?? ""));
      const lead = leads.get(String(r.lead_id ?? ""));
      return {
        id: String(r.id),
        type: String(r.type ?? ""),
        severity: Number(r.severity ?? 3),
        evidence: (r.evidence ?? {}) as Record<string, unknown>,
        detectedAt: String(r.detected_at ?? ""),
        lastSeenAt: String(r.last_seen_at ?? ""),
        seenCount: Number(r.seen_count ?? 1),
        expiresAt: r.expires_at ? String(r.expires_at) : null,
        acknowledged: r.acknowledged_at != null,
        leadId: r.lead_id ? String(r.lead_id) : null,
        opportunityId: r.opportunity_id ? String(r.opportunity_id) : null,
        stage: opp?.stage ? String(opp.stage) : null,
        leadName:
          [lead?.first_name, lead?.last_name].filter(Boolean).join(" ").trim() || null,
        phone: lead?.phone ? String(lead.phone) : null,
      };
    });
  return NextResponse.json({ signals: rows });
}

export async function PATCH(req: Request) {
  const scope = await getScope();
  if (!scope?.orgId || !scope.userId || !isAdminConfigured()) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    action?: "acknowledge" | "dismiss" | "false_positive" | "actioned";
  };
  if (!body.id || !body.action) {
    return NextResponse.json({ error: "id and action are required." }, { status: 400 });
  }
  const admin = createAdminClient();
  const iso = new Date().toISOString();
  const patch: Record<string, unknown> =
    body.action === "acknowledge"
      ? { acknowledged_by: scope.userId, acknowledged_at: iso }
      : {
          resolved_at: iso,
          resolution:
            body.action === "dismiss"
              ? "dismissed"
              : body.action === "false_positive"
                ? "false_positive"
                : "actioned",
          acknowledged_by: scope.userId,
          acknowledged_at: iso,
        };
  // Org-fenced update — a signal id from another tenant matches zero rows.
  const { error } = await admin
    .from("signals")
    .update(patch)
    .eq("id", body.id)
    .eq("org_id", scope.orgId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
