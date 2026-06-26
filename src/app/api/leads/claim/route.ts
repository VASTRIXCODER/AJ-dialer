import { NextResponse } from "next/server";
import { claimLeads } from "@/lib/db/leads";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Claim leads to the signed-in user ("assign to my name"). Open to any active
 * org member (reps included) — claimLeads scopes the change to the caller's org
 * and RLS only allows setting owner_id to yourself. This is how a rep pulls
 * shared-pool leads into their own dial queue.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.user || !viewer.org) {
    return NextResponse.json(
      { updated: 0, error: "Join an organization to claim leads." },
      { status: 403 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as { leadIds?: string[] };
  if (!Array.isArray(body.leadIds) || body.leadIds.length === 0) {
    return NextResponse.json({ updated: 0, error: "No leads selected." }, { status: 400 });
  }

  const result = await claimLeads(body.leadIds.slice(0, 10000));
  return NextResponse.json(result, { status: result.error ? 400 : 200 });
}
