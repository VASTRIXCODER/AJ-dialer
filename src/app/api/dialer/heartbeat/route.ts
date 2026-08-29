import { NextResponse } from "next/server";
import { renewReservations } from "@/lib/db/reservations";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/** Renew this rep's unexpired claims while the leads are still on screen. */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const scope = await getScope();
  if (!scope?.orgId || !scope.userId) return NextResponse.json({ renewed: 0 });

  const body = (await req.json().catch(() => ({}))) as { leadIds?: string[] };
  const leadIds = Array.isArray(body.leadIds) ? body.leadIds.slice(0, 200) : [];
  const renewed = await renewReservations(scope.orgId, scope.userId, leadIds);
  return NextResponse.json({ renewed });
}
