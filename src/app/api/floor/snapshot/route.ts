import { NextResponse } from "next/server";
import { isMediaStreamConfigured } from "@/lib/media-stream";
import { getAiActiveForFloor, getFloorPace } from "@/lib/monitor/floor-data";
import { getViewer } from "@/lib/org/membership";
import { listActiveHumanCallsForOrg } from "@/lib/human-call-store";
import { isAIBridgeConfigured } from "@/lib/elevenlabs";
import { listPresenceForOrg } from "@/lib/presence-store";
import { timing } from "@/lib/telemetry";
import { isRestConfigured, isVoiceConfigured } from "@/lib/twilio";
import type { PresenceStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The Live Floor's ONE snapshot — humans (live_calls), the AI active set
 * (store⊕DB merge with the provider reconcile throttled to 15s/org — see
 * floor-data.ts), the presence fallback, and roster/pace — in a single
 * supervisor-authorized read. The floor polls THIS slowly (the org channel's
 * `call.state` broadcasts carry the fast path); the legacy 2s consumer routes
 * (/api/elevenlabs/conversations, /api/calls/active) stay for compat.
 */

/** Server presence → the channel-claim vocabulary the floor merge consumes.
 *  "live"/"dialing" claims map to "dialing": a CLAIM never asserts a connected
 *  call — only webhook-proven calls do (the floor-merge rule). */
const PRESENCE_TO_CLAIM: Record<
  PresenceStatus,
  "available" | "paused" | "wrapup" | "dialing" | "ai"
> = {
  idle: "available",
  dialing: "dialing",
  live: "dialing",
  wrapup: "wrapup",
  ai: "ai",
};

export async function GET() {
  const t0 = Date.now();
  const viewer = await getViewer();
  if (!viewer.permissions.includes("monitor.view"))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const org = viewer.org;
  if (!org) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const [humans, ai, presence, pace] = await Promise.all([
    listActiveHumanCallsForOrg(org.id),
    getAiActiveForFloor(org.id),
    listPresenceForOrg(org.id),
    getFloorPace(org.id, org.timezone),
  ]);

  const nameById = new Map(pace.roster.map((r) => [r.userId, r.name]));

  const body = {
    humans: humans.map((c) => ({
      id: c.id,
      ownerId: c.ownerId,
      repName: c.repName || (c.ownerId ? (nameById.get(c.ownerId) ?? "") : ""),
      leadName: c.leadName,
      city: c.city,
      phone: c.phone,
      state: c.state,
      startedAt: c.startedAt,
      connectedAt: c.connectedAt,
      // The Twilio conference exists once the call is connected — that's when a
      // supervisor can join it muted (same rule as /api/calls/active).
      canListen: c.state === "connected",
    })),
    ai,
    presenceFallback: presence.map((p) => ({
      userId: p.userId,
      name: nameById.get(p.userId) ?? "",
      status: PRESENCE_TO_CLAIM[p.status] ?? "available",
      statusSince: p.statusSince,
    })),
    roster: pace.roster,
    callsToday: pace.callsToday,
    totalCallsToday: pace.totalCallsToday,
    // Honest capability flags so floor controls can disable WITH a reason
    // instead of failing on click.
    capabilities: {
      humanListen: isVoiceConfigured(),
      aiLiveAudio:
        isAIBridgeConfigured() || (isMediaStreamConfigured() && isRestConfigured()),
    },
    generatedAt: new Date().toISOString(),
  };

  timing("floor.snapshot_ms", Date.now() - t0, { orgId: org.id });
  return NextResponse.json(body, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
