import { NextResponse } from "next/server";
import { assignLeadsToRep } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Assign leads to a rep WITHOUT changing the uploader (sets assigned_rep_id).
 * The lead then enters that rep's dial queue + Leads tab while attribution to the
 * original uploader is preserved. Pass toUserId: null to clear the assignment.
 * Gated on the lead-management permission (supervisors); assignLeadsToRep
 * additionally scopes to the caller's org and validates the target is a member.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { updated: 0, error: "You don't have permission to assign leads." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    leadIds?: string[];
    toUserId?: string | null;
  };
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ updated: 0, error: "No leads selected." }, { status: 400 });
  }

  const result = await assignLeadsToRep(
    body.leadIds.slice(0, 10000),
    body.toUserId ? String(body.toUserId) : null,
  );
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
