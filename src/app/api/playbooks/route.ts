import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/db/app-control";
import { validateDefinition, type PlaybookDefinition } from "@/lib/orchestration/definition";
import { SEED_TEMPLATES } from "@/lib/orchestration/templates";
import { getViewer } from "@/lib/org/membership";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Playbook administration (P2.2 — the Studio-lite; the visual builder is
// P2.10). Templates install as DRAFTS; publish runs the STRICT validator and
// stamps version + audit; pause freezes ticks; retire additionally stops
// instances on the next tick. The AI has no path into this table — every
// mutation is an authorized human through this route (org.edit).
// ─────────────────────────────────────────────────────────────────────────────

async function authz() {
  const viewer = await getViewer();
  if (!viewer.org?.id || !viewer.user) {
    return { error: NextResponse.json({ error: "Join an organization first." }, { status: 403 }) };
  }
  if (!viewer.permissions.includes("org.edit")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!isAdminConfigured()) {
    return { error: NextResponse.json({ error: "Connect Supabase first." }, { status: 503 }) };
  }
  return { viewer, orgId: viewer.org.id, userId: viewer.user.id };
}

export async function GET() {
  const a = await authz();
  if ("error" in a) return a.error;
  const { data } = await createAdminClient()
    .from("playbooks")
    .select("id, name, version, status, definition, published_at, updated_at")
    .eq("org_id", a.orgId)
    .order("updated_at", { ascending: false })
    .limit(100);
  return NextResponse.json({
    playbooks: data ?? [],
    templates: SEED_TEMPLATES.map((t) => ({
      key: t.key,
      name: t.name,
      trigger: t.trigger.kind === "event" ? t.trigger.event : t.trigger.kind,
      steps: t.steps.length,
    })),
    orchestrationEnabled:
      a.viewer.org?.settings.orchestration.enabled === true,
  });
}

export async function POST(req: Request) {
  const a = await authz();
  if ("error" in a) return a.error;
  const body = (await req.json().catch(() => ({}))) as { templateKey?: string };
  const template = SEED_TEMPLATES.find((t) => t.key === body.templateKey);
  if (!template) {
    return NextResponse.json({ error: "Unknown template." }, { status: 400 });
  }
  const admin = createAdminClient();
  // One draft/live copy per template key per org — installing twice is a no-op
  // pointer to the existing one, not a duplicate.
  const { data: existing } = await admin
    .from("playbooks")
    .select("id, status")
    .eq("org_id", a.orgId)
    .eq("name", template.name)
    .neq("status", "retired")
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, existed: true });
  }
  const { data, error } = await admin
    .from("playbooks")
    .insert({
      org_id: a.orgId,
      name: template.name,
      status: "draft",
      definition: template as unknown as Record<string, unknown>,
      created_by: a.userId,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? "Install failed." }, { status: 500 });
  }
  await writeAudit({
    action: "playbook.install",
    actorId: a.userId,
    targetId: String(data.id),
    targetKind: "playbook",
    orgId: a.orgId,
    detail: { template: template.key },
  });
  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(req: Request) {
  const a = await authz();
  if ("error" in a) return a.error;
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    action?: "publish" | "pause" | "resume" | "retire";
  };
  if (!body.id || !body.action) {
    return NextResponse.json({ error: "id and action are required." }, { status: 400 });
  }
  const admin = createAdminClient();
  const { data: pb } = await admin
    .from("playbooks")
    .select("id, org_id, status, version, definition")
    .eq("id", body.id)
    .maybeSingle();
  if (!pb || String(pb.org_id) !== a.orgId) {
    return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.action === "publish" || body.action === "resume") {
    // STRICT validation is the publish gate — a published playbook may never
    // promise what the engine can't safely execute (reserved kinds fail here).
    const verdict = validateDefinition(pb.definition as PlaybookDefinition);
    if (!verdict.ok) {
      return NextResponse.json(
        { error: "This playbook can't be published yet.", validation: verdict.errors },
        { status: 422 },
      );
    }
    patch.status = "published";
    patch.published_by = a.userId;
    patch.published_at = new Date().toISOString();
    if (pb.status === "draft") patch.version = Number(pb.version ?? 1);
    if (pb.status === "retired") {
      return NextResponse.json({ error: "Retired playbooks stay retired — install a fresh copy." }, { status: 400 });
    }
  } else if (body.action === "pause") {
    if (pb.status !== "published") {
      return NextResponse.json({ error: "Only a published playbook can pause." }, { status: 400 });
    }
    patch.status = "paused";
  } else if (body.action === "retire") {
    patch.status = "retired";
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const { error } = await admin.from("playbooks").update(patch).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await writeAudit({
    action: `playbook.${body.action}`,
    actorId: a.userId,
    targetId: body.id,
    targetKind: "playbook",
    orgId: a.orgId,
    detail: { from: pb.status },
  });
  return NextResponse.json({ ok: true });
}
