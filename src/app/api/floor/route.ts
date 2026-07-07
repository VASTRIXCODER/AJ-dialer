import { NextResponse } from "next/server";
import { getDialerFloor } from "@/lib/db/floor";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Live-floor snapshot for the power dialer: who's dialing right now + each rep's
 * calls today, org-wide. Available to ANY signed-in org member (it's a team
 * roster, not the supervisor-only Live Monitor) and strictly org-scoped.
 */
export async function GET() {
  const viewer = await getViewer();
  if (!viewer.user || !viewer.org) {
    return NextResponse.json({ dialers: [], totalCallsToday: 0, activeCount: 0, meId: null });
  }
  const floor = await getDialerFloor(viewer.org.id, viewer.org.timezone || "UTC");
  return NextResponse.json({ ...floor, meId: viewer.user.id });
}
