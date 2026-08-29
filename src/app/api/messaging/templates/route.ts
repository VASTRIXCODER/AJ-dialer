import { NextResponse } from "next/server";
import { writeAudit } from "@/lib/db/app-control";
import { renderTemplate, renderValues, templateVariables } from "@/lib/messaging/render";
import { SEED_MESSAGE_TEMPLATES, seedVariables } from "@/lib/messaging/templates";
import { getViewer } from "@/lib/org/membership";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Message templates: install the seeds, publish one, unpublish one.
//
// Seeds install as DRAFTS. Nothing here publishes anything automatically — a
// human reads every word before a customer does, which is the same reason the
// playbook seeds install as drafts.
//
// Publishing runs a real check first: the body must render against a full set
// of values, so a template referencing a variable the renderer cannot supply is
// refused at publish rather than discovered when it reaches someone's phone as
// "Hi {{firstName}}".
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

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
  return { orgId: viewer.org.id, userId: viewer.user.id };
}

export async function GET() {
  const auth = await authz();
  if ("error" in auth) return auth.error;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("message_templates")
      .select("id, key, name, version, status, scope, body, variables, published_at")
      .eq("org_id", auth.orgId)
      .neq("status", "archived")
      .order("key", { ascending: true });
    const rows = ((data ?? []) as Row[]).map((t) => ({
      id: s(t.id),
      key: s(t.key),
      name: s(t.name),
      version: Number(t.version ?? 1),
      status: s(t.status),
      scope: s(t.scope),
      body: s(t.body),
      publishedAt: t.published_at ? s(t.published_at) : null,
    }));
    const installedKeys = new Set(rows.map((r) => r.key));
    return NextResponse.json({
      templates: rows,
      // What could still be installed, so the panel offers the gap rather than
      // a button that silently does nothing.
      available: SEED_MESSAGE_TEMPLATES.filter((t) => !installedKeys.has(t.key)).map((t) => ({
        key: t.key,
        name: t.name,
        scope: t.scope,
        purpose: t.purpose,
      })),
    });
  } catch {
    return NextResponse.json({ templates: [], available: [] });
  }
}

export async function POST(req: Request) {
  const auth = await authz();
  if ("error" in auth) return auth.error;
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    id?: string;
    keys?: string[];
  };
  const admin = createAdminClient();

  if (body.action === "install") {
    const wanted = Array.isArray(body.keys) && body.keys.length
      ? SEED_MESSAGE_TEMPLATES.filter((t) => body.keys!.includes(t.key))
      : SEED_MESSAGE_TEMPLATES;
    let installed = 0;
    for (const t of wanted) {
      const { data: existing } = await admin
        .from("message_templates")
        .select("id")
        .eq("org_id", auth.orgId)
        .eq("key", t.key)
        .maybeSingle();
      if (existing) continue;
      const { error } = await admin.from("message_templates").insert({
        org_id: auth.orgId,
        key: t.key,
        name: t.name,
        // DRAFT. Nothing installs published — a human reads every word first.
        status: "draft",
        scope: t.scope,
        channel: "sms",
        body: t.body,
        variables: seedVariables(t.body),
        created_by: auth.userId,
      });
      if (!error) installed += 1;
    }
    await writeAudit({
      orgId: auth.orgId,
      actorId: auth.userId,
      action: "messaging.templates_installed",
      detail: { installed },
    });
    return NextResponse.json({ ok: true, installed });
  }

  if (body.action === "publish" || body.action === "unpublish") {
    const id = String(body.id ?? "");
    if (!id) return NextResponse.json({ error: "Which template?" }, { status: 422 });

    const { data: tpl } = await admin
      .from("message_templates")
      .select("id, key, body, status")
      .eq("id", id)
      .eq("org_id", auth.orgId)
      .maybeSingle();
    if (!tpl) return NextResponse.json({ error: "Not found." }, { status: 404 });

    if (body.action === "unpublish") {
      await admin
        .from("message_templates")
        .update({ status: "draft", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("org_id", auth.orgId);
      return NextResponse.json({ ok: true, status: "draft" });
    }

    // A real render against a full set of values. A template referencing a
    // variable the renderer cannot supply must fail HERE, in front of the
    // person publishing it — not on a stranger's phone.
    const probe = renderTemplate(
      s(tpl.body),
      renderValues({
        firstName: "Sample",
        lastName: "Person",
        appointmentNoun: "appointment",
        appointmentDate: "Tuesday",
        appointmentTime: "2pm",
        repName: "A rep",
        orgName: "This workspace",
        replyNumber: "+15555550123",
      }),
    );
    if (!probe.ok) {
      return NextResponse.json(
        {
          error: `This template uses ${probe.unresolved.join(", ")}, which the renderer can't fill. Every message would go out with the placeholder still in it, so it can't be published.`,
          unresolved: probe.unresolved,
        },
        { status: 422 },
      );
    }

    const { error } = await admin
      .from("message_templates")
      .update({
        status: "published",
        variables: templateVariables(s(tpl.body)),
        published_by: auth.userId,
        published_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("org_id", auth.orgId);
    if (error) {
      // The partial unique index: one live version per key.
      return NextResponse.json(
        { error: "Another version of this template is already published." },
        { status: 409 },
      );
    }
    await writeAudit({
      orgId: auth.orgId,
      actorId: auth.userId,
      action: "messaging.template_published",
      detail: { key: s(tpl.key) },
    });
    return NextResponse.json({ ok: true, status: "published", segments: probe.segments });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 422 });
}
