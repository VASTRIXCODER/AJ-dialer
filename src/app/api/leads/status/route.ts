import { NextResponse } from "next/server";
import { setLeadsStatus } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";
import type { LeadStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Bulk-set a status on selected leads (list hygiene — mark Do Not Call, reset to
 * New, etc.). Gated on the lead-management permission (managers+); setLeadsStatus
 * validates the status and scopes the change to the caller's org.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { updated: 0, error: "You don't have permission to update leads." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    leadIds?: string[];
    status?: LeadStatus;
  };
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ updated: 0, error: "No leads selected." }, { status: 400 });
  }
  if (!body.status) {
    return NextResponse.json({ updated: 0, error: "Choose a status." }, { status: 400 });
  }

  const result = await setLeadsStatus(body.leadIds.slice(0, 10000), body.status);
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
