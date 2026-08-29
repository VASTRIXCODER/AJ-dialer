import { NextResponse } from "next/server";
import { releaseCallWorkItemsForRep } from "@/lib/db/opportunities";
import { releaseDialLeads } from "@/lib/db/reservations";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/** Release this rep's own claims (skip, session end). Others' holds untouched. */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const scope = await getScope();
  if (!scope?.orgId || !scope.userId) return NextResponse.json({ released: 0 });

  const body = (await req.json().catch(() => ({}))) as { leadIds?: string[] };
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.slice(0, 200) : [];
  const released = await releaseDialLeads(scope.orgId, scope.userId, leadIds);
  // Hand back the matching work-item reservations too (P2.3 threading).
  // Scoped to the SAME ids as the lead release — releaseDialLeads no-ops on an
  // empty list, so releasing every held work item here would leave the rep
  // holding leads whose work items had become claimable by someone else.
  if (leadIds.length) {
    void releaseCallWorkItemsForRep({
      orgId: scope.orgId,
      repId: scope.userId,
      leadIds,
    });
  }
  return NextResponse.json({ released });
}
