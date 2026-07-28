import { NextResponse } from "next/server";
import { deleteLeads } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Delete leads, individually or in bulk.
 *
 * There is deliberately NO permission gate here, because "may this account
 * delete leads at all" is the wrong question — the answer depends on WHICH
 * leads. deleteLeads() resolves that per row: a supervisor (owner/admin/
 * manager) may clear the shared org pool, while a rep may only delete leads
 * they uploaded themselves. Gating the route on `leads.import` instead would
 * mean a rep couldn't tidy up their own bad import, and passing that gate
 * would NOT be sufficient authority to delete a teammate's uploads anyway.
 * Ids the caller isn't entitled to match nothing and come back as not-deleted.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.user && !viewer.isDemo) {
    return NextResponse.json(
      { deleted: 0, error: "You must be signed in to delete leads." },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { leadIds?: string[] };
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ deleted: 0, error: "No leads selected." }, { status: 400 });
  }

  const result = await deleteLeads(body.leadIds.slice(0, 10000));
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
