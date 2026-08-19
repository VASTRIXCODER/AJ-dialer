import { NextResponse } from "next/server";
import { countyForZip } from "@/lib/leads/zip-county";
import { getViewer } from "@/lib/org/membership";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Never touch more than this in one request — keeps the call inside the
 *  function timeout. No AI call here (deterministic zip lookup), so this can
 *  run a much bigger batch per click than the group sorter's 2,000. */
const MAX_PER_RUN = 10_000;

/**
 * Stamp `county` onto leads that predate this feature (or were imported before
 * their county could be resolved for some other reason — a since-corrected
 * ZIP typo, for instance).
 *
 * Purely deterministic: no AI, no chunking, no token budget — every lead
 * either has a ZIP that resolves to a county or it doesn't (see
 * countyForZip). Only ever reads leads with `county is null` and only ever
 * writes a county onto a lead that had none, so it can never overwrite a
 * value — there's nothing to overwrite from any other source anyway.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { error: "You don't have permission to edit leads." },
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
  const limit = Math.max(1, Math.min(MAX_PER_RUN, Math.floor(Number(body.limit)) || 5000));

  const admin = createAdminClient();
  const { data: rows, error } = await admin
    .from("leads")
    .select("id, zip")
    .eq("org_id", orgId)
    .is("county", null)
    .not("zip", "is", null)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: "Couldn't read the un-countied leads." }, { status: 500 });
  }
  if (!rows?.length) {
    return NextResponse.json({ checked: 0, updated: 0, unmatched: 0, remaining: 0 });
  }

  // Group ids by resolved county so this is one UPDATE per county rather than
  // one per lead — 10,000 individual round-trips would blow the timeout.
  const byCounty = new Map<string, string[]>();
  let unmatched = 0;
  for (const r of rows) {
    const match = countyForZip(r.zip as string | null);
    if (!match) {
      unmatched++;
      continue;
    }
    const list = byCounty.get(match.county) ?? [];
    list.push(String(r.id));
    byCounty.set(match.county, list);
  }

  let updated = 0;
  for (const [county, ids] of byCounty) {
    // `.is("county", null)` again: between the read and this write, a re-import
    // or a concurrent run of this same button may already have filled it in.
    const { data: rowsUpdated } = await admin
      .from("leads")
      .update({ county })
      .eq("org_id", orgId)
      .is("county", null)
      .in("id", ids)
      .select("id");
    updated += rowsUpdated?.length ?? 0;
  }

  const { count: remaining } = await admin
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .is("county", null)
    .not("zip", "is", null);

  return NextResponse.json({
    checked: rows.length,
    updated,
    unmatched,
    remaining: remaining ?? 0,
  });
}
