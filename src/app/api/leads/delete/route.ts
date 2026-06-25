import { NextResponse } from "next/server";
import { deleteLeads } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Delete leads (individual or bulk) from the shared org pool. Gated on the
 * lead-management permission (managers/admins/owners) so reps working the pool
 * can't wipe it; RLS additionally restricts deletes to the caller's own org.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { deleted: 0, error: "You don't have permission to delete leads." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { leadIds?: string[] };
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ deleted: 0, error: "No leads selected." }, { status: 400 });
  }

  const result = await deleteLeads(body.leadIds.slice(0, 10000));
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
