import { NextResponse } from "next/server";
import { distributeLeads } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Distribute the selected leads evenly across teammates (round-robin). Gated on
 * the lead-management permission (supervisors); distributeLeads additionally
 * scopes to the caller's org and validates every target is a member.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { updated: 0, error: "You don't have permission to distribute leads." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    leadIds?: string[];
    toUserIds?: string[];
  };
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ updated: 0, error: "No leads selected." }, { status: 400 });
  }
  if (!Array.isArray(body.toUserIds) || body.toUserIds.length === 0) {
    return NextResponse.json(
      { updated: 0, error: "No teammates to distribute to." },
      { status: 400 },
    );
  }

  const result = await distributeLeads(body.leadIds.slice(0, 10000), body.toUserIds);
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
