import { NextResponse } from "next/server";
import {
  connectHumanCall,
  endHumanCall,
  listActiveHumanCallsForOrg,
  startHumanCall,
} from "@/lib/human-call-store";
import { getViewer, viewerCan } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * Live human (manual) call presence for the Live Monitor. GET is the supervisor
 * feed — gated to monitor.view and scoped to the viewer's org. POST is the rep's
 * own browser registering its call lifecycle (start / connect / end).
 */
export async function GET() {
  if (!(await viewerCan("monitor.view")))
    return NextResponse.json({ active: [] }, { status: 403 });
  const viewer = await getViewer();
  const calls = await listActiveHumanCallsForOrg(viewer.org?.id ?? null);
  const active = calls.map((c) => ({
    id: c.id,
    leadName: c.leadName,
    city: c.city,
    phone: c.phone,
    state: c.state,
    startedAt: c.startedAt,
    repName: c.repName,
    // Once the call is connected, its Twilio conference exists and a supervisor
    // can join it (muted) to listen. Tied to the connected state — which the
    // rep's browser reports — rather than the voice webhook's CallSid, which on
    // serverless may have landed on a different instance than this request.
    canListen: c.state === "connected",
  }));
  return NextResponse.json({ active });
}

export async function POST(req: Request) {
  const { action, id, leadName, city, phone } = (await req
    .json()
    .catch(() => ({}))) as {
    action?: "start" | "connect" | "end";
    id?: string;
    leadName?: string;
    city?: string;
    phone?: string;
  };

  if (!id || !action) {
    return NextResponse.json(
      { error: "id and action are required" },
      { status: 400 },
    );
  }

  if (action === "start") {
    // Attribute the call to the signed-in rep + their org so supervisors in the
    // same org can see and listen to it.
    const viewer = await getViewer();
    await startHumanCall({
      id,
      leadName: leadName ?? "Manual call",
      city,
      phone,
      ownerId: viewer.user?.id ?? null,
      orgId: viewer.org?.id ?? null,
      repName: viewer.displayName,
    });
  } else if (action === "connect") {
    await connectHumanCall(id);
  } else {
    await endHumanCall(id);
  }

  return NextResponse.json({ ok: true });
}
