import { NextResponse } from "next/server";
import { getViewer, listMembers, viewerCan } from "@/lib/org/membership";
import {
  clearPresence,
  listPresenceForOrg,
  upsertPresence,
  type PresenceStatus,
} from "@/lib/presence-store";

export const dynamic = "force-dynamic";

const VALID_STATUS = new Set<PresenceStatus>(["idle", "dialing", "live", "wrapup", "ai"]);

// Manager-only roster gets on-call reps to the top, idle beneath, alphabetical
// within each tier — so a manager sees who needs attention first.
const STATUS_PRIORITY: Record<PresenceStatus, number> = {
  live: 0,
  dialing: 1,
  ai: 2,
  wrapup: 3,
  idle: 4,
};

/**
 * Live per-user presence for the Team Status roster. GET is the manager feed —
 * gated to monitor.roster and scoped to the viewer's org. POST is any active
 * org member's browser reporting its own dialer status/lead heartbeat.
 */
export async function GET() {
  if (!(await viewerCan("monitor.roster")))
    return NextResponse.json({ team: [] }, { status: 403 });

  const viewer = await getViewer();
  const orgId = viewer.org?.id ?? null;
  if (!orgId) return NextResponse.json({ team: [] });

  const [presence, members] = await Promise.all([
    listPresenceForOrg(orgId),
    listMembers(orgId),
  ]);
  const byUserId = new Map(members.map((m) => [m.userId, m]));

  const team = presence
    .map((p) => {
      const member = byUserId.get(p.userId);
      return {
        userId: p.userId,
        name: member?.name || member?.email || "Teammate",
        role: member?.role ?? "rep",
        status: p.status,
        leadName: p.leadName,
        leadCity: p.leadCity,
        leadPhone: p.leadPhone,
        aiActiveCount: p.aiActiveCount,
        updatedAt: p.updatedAt,
        statusSince: p.statusSince,
      };
    })
    .sort((a, b) => {
      const rank = STATUS_PRIORITY[a.status] - STATUS_PRIORITY[b.status];
      return rank !== 0 ? rank : a.name.localeCompare(b.name);
    });

  return NextResponse.json({ team });
}

export async function POST(req: Request) {
  const { status, lead, aiActiveCount } = (await req
    .json()
    .catch(() => ({}))) as {
    status?: string;
    lead?: { name?: string; city?: string; phone?: string } | null;
    aiActiveCount?: number;
  };

  // Identity comes from the session, never the request body — a rep can only
  // ever report their OWN presence, never spoof another user's row.
  const viewer = await getViewer();
  if (!viewer.user || !viewer.org) return NextResponse.json({ ok: true });

  if (status === "offline") {
    await clearPresence(viewer.user.id);
    return NextResponse.json({ ok: true });
  }

  if (!status || !VALID_STATUS.has(status as PresenceStatus)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await upsertPresence({
    userId: viewer.user.id,
    orgId: viewer.org.id,
    status: status as PresenceStatus,
    lead,
    aiActiveCount,
  });

  return NextResponse.json({ ok: true });
}
