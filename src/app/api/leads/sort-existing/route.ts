import { NextResponse } from "next/server";
import { classifyLeadsIntoGroups } from "@/lib/ai/classify-leads";
import { listLeadGroups } from "@/lib/db/lead-groups";
import { getViewer } from "@/lib/org/membership";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Never sort more than this in one request — keeps the call inside the
 *  function timeout and the AI spend per click predictable. */
const MAX_PER_RUN = 2000;

/**
 * Sort leads that are ALREADY in the workspace and sitting in Miscellaneous.
 *
 * The other half of the sort-limit feature: an upload of 10,000 rows sorts the
 * first N and files the rest as Miscellaneous, and this is the button that
 * works through the remainder N at a time until the bucket is empty. Also the
 * repair path for leads that came in before the org defined its groups, or
 * after it added a new one — re-running this re-files anything the fresh
 * taxonomy can now place.
 *
 * Only ever READS from Miscellaneous and only ever WRITES a group onto a lead
 * that had none, so it can't re-file a lead an admin deliberately placed.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { error: "You don't have permission to sort leads." },
      { status: 403 },
    );
  }
  const orgId = viewer.org?.id;
  if (!orgId) {
    return NextResponse.json({ error: "No active workspace." }, { status: 400 });
  }
  if (!isAdminConfigured()) {
    return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { limit?: number };
  const limit = Math.max(1, Math.min(MAX_PER_RUN, Math.floor(Number(body.limit)) || 500));

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("leads")
    .select("id, city, state, zip, utility_provider, utility_bill, solar_payment")
    .eq("org_id", orgId)
    .is("lead_group", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "Couldn't read the Miscellaneous leads." }, { status: 500 });
  }
  if (!rows?.length) {
    return NextResponse.json({ sorted: 0, placed: 0, remaining: 0, source: "demo" });
  }

  const groups = await listLeadGroups(orgId);
  const { data: outcomes, source, chunkFailures } = await classifyLeadsIntoGroups(
    rows.map((r) => ({
      tempId: String(r.id),
      city: (r.city as string) ?? "",
      state: (r.state as string) ?? "",
      zip: (r.zip as string) ?? "",
      utilityProvider: (r.utility_provider as string) ?? undefined,
      utilityBill: r.utility_bill == null ? undefined : Number(r.utility_bill),
      solarPayment: r.solar_payment == null ? undefined : Number(r.solar_payment),
    })),
    groups,
  );

  // Group the ids by target key so this is one UPDATE per group rather than one
  // per lead — 2,000 individual round-trips would blow the function timeout.
  const byGroup = new Map<string, string[]>();
  for (const o of outcomes) {
    if (!o.group) continue;
    const list = byGroup.get(o.group) ?? [];
    list.push(o.tempId);
    byGroup.set(o.group, list);
  }

  let placed = 0;
  for (const [key, ids] of byGroup) {
    // `.is("lead_group", null)` again: between the read and this write an admin
    // may have filed one by hand, and their choice must win over the model's.
    const { data: updated } = await admin
      .from("leads")
      .update({ lead_group: key })
      .eq("org_id", orgId)
      .is("lead_group", null)
      .in("id", ids)
      .select("id");
    placed += updated?.length ?? 0;
  }

  const { count: remaining } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("lead_group", null);

  return NextResponse.json({
    sorted: rows.length,
    placed,
    remaining: remaining ?? 0,
    source,
    chunkFailures,
  });
}
