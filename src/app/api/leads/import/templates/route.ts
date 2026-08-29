import { NextResponse } from "next/server";
import { sanitizeColumnPlan } from "@/lib/leads/parse-request";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Saved column-mapping templates, org-scoped. A team that gets the same broker
 *  export every month maps it once, saves the mapping, and re-applies it. */

type Row = Record<string, unknown>;

function rowToTemplate(r: Row) {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    headerSig: String(r.header_sig ?? ""),
    plan: r.plan ?? null,
    createdAt: String(r.created_at ?? ""),
    lastUsedAt: r.last_used_at ? String(r.last_used_at) : null,
  };
}

async function gate() {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return { error: "You don't have permission to import leads.", status: 403 as const };
  }
  if (!viewer.org?.id) {
    return { error: "Join a workspace first.", status: 400 as const };
  }
  if (!isAdminConfigured()) {
    return { error: "Connect Supabase to save mapping templates.", status: 503 as const };
  }
  return { viewer, orgId: viewer.org.id };
}

export async function GET() {
  const g = await gate();
  if ("error" in g) {
    // Demo mode renders an empty list rather than an error banner.
    if (g.status === 503) return NextResponse.json({ templates: [] });
    return NextResponse.json({ error: g.error }, { status: g.status });
  }
  try {
    const { data } = await createAdminClient()
      .from("import_mapping_templates")
      .select("id, name, header_sig, plan, created_at, last_used_at")
      .eq("org_id", g.orgId)
      .order("created_at", { ascending: false })
      .limit(50);
    return NextResponse.json({ templates: ((data ?? []) as Row[]).map(rowToTemplate) });
  } catch {
    return NextResponse.json({ templates: [] });
  }
}

export async function POST(req: Request) {
  const g = await gate();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const rl = rateLimit(`import-templates:${g.viewer.user?.id ?? clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many templates saved in a row — wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    headerSig?: string;
    plan?: unknown;
  };
  const name = String(body.name ?? "").trim().slice(0, 80);
  if (!name) {
    return NextResponse.json({ error: "Give the template a name." }, { status: 400 });
  }
  // The plan came from the browser — rebuild it from recognised values only.
  const plan = sanitizeColumnPlan(body.plan);
  if (!plan) {
    return NextResponse.json({ error: "That mapping can't be saved." }, { status: 400 });
  }
  try {
    const { data, error } = await createAdminClient()
      .from("import_mapping_templates")
      .insert({
        org_id: g.orgId,
        name,
        header_sig: String(body.headerSig ?? "").slice(0, 500),
        plan,
        created_by: g.viewer.user?.id ?? null,
      })
      .select("id")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: "Couldn't save the template." }, { status: 500 });
    }
    return NextResponse.json({ id: String((data as Row).id) });
  } catch {
    return NextResponse.json({ error: "Couldn't save the template." }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const g = await gate();
  if ("error" in g) return NextResponse.json({ error: g.error }, { status: g.status });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "Unknown template." }, { status: 404 });
  }
  try {
    // Org-scoped delete: the id alone is never enough to reach another tenant's.
    const { error } = await createAdminClient()
      .from("import_mapping_templates")
      .delete()
      .eq("id", id)
      .eq("org_id", g.orgId);
    if (error) {
      return NextResponse.json({ error: "Couldn't delete the template." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't delete the template." }, { status: 500 });
  }
}
