import { NextResponse } from "next/server";
import { reassignLeads } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Reassign leads to a different uploader/account (move them between reps). Gated
 * on the lead-management permission (supervisors); reassignLeads additionally
 * scopes the move to the caller's org and validates the target is a member.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { updated: 0, error: "You don't have permission to reassign leads." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    leadIds?: string[];
    toUserId?: string;
  };
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ updated: 0, error: "No leads selected." }, { status: 400 });
  }
  if (!body.toUserId) {
    return NextResponse.json(
      { updated: 0, error: "Choose who to reassign to." },
      { status: 400 },
    );
  }

  const result = await reassignLeads(body.leadIds.slice(0, 10000), String(body.toUserId));
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
