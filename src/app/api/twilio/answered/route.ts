import { NextResponse } from "next/server";
import { resolveAnswer } from "@/lib/dial-answer";
import { getHumanCall } from "@/lib/human-call-store";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";
import { count } from "@/lib/telemetry";
import { getRestClient } from "@/lib/twilio";

export const dynamic = "force-dynamic";

interface Leg {
  leadId: string;
  sid: string | null;
}

const ROOM_RE = /^hc-[\w-]{1,80}$/;

/**
 * Connect detection for human (conference) calls — serverless-safe.
 *
 * The browser sends the placed homeowner leg(s); we read their live status from
 * Twilio (the shared source of truth) rather than from in-memory state that a
 * different serverless instance may not hold. Returns the first answered
 * (in-progress) leg and releases the other still-ringing legs so only the winner
 * is bridged. When every leg has ended without answering, returns `done: true`
 * so the client can wrap up. Works for both single and parallel dialing.
 *
 * AUTH: this route used to accept arbitrary SIDs from anyone on the internet and
 * would HANG UP whichever calls it decided were "losers" — unauthenticated call
 * teardown for the whole Twilio account. Now:
 *   1. a signed-in session is required (demo mode passes; it has no REST client);
 *   2. the caller sends the conference `room` they claim to own, and releases are
 *      only performed when the live_calls row for that room belongs to the caller
 *      (or the caller holds monitor.intervene in the row's org);
 *   3. when the row is missing (start/end races the poll), we degrade to
 *      STATUS READS ONLY — never a release — so the client can still detect
 *      answer/done, but an unverified request can never terminate a call.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const rl = rateLimit(`answered:${viewer.user?.id ?? "demo"}`, 240, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { room, legs } = (await req.json().catch(() => ({}))) as {
    room?: string;
    legs?: Leg[];
  };
  const list = (legs ?? [])
    .slice(0, 10)
    .filter((l): l is { leadId: string; sid: string } => Boolean(l && l.sid));
  if (!list.length)
    return NextResponse.json({ answeredLeadId: null, done: true });

  // Ownership: the live_calls row for this conference names the rep who placed
  // it. Verified ⇒ full behavior. Missing/mismatched ⇒ reads only.
  let mayRelease = false;
  if (typeof room === "string" && ROOM_RE.test(room)) {
    const call = await getHumanCall(room.slice(3));
    if (call) {
      const isOwner = Boolean(viewer.user?.id) && call.ownerId === viewer.user?.id;
      const isSupervisor =
        Boolean(call.orgId) &&
        call.orgId === viewer.org?.id &&
        viewer.permissions.includes("monitor.intervene");
      if (!isOwner && !isSupervisor && !viewer.isDemo) {
        return NextResponse.json(
          { error: "That call belongs to someone else." },
          { status: 403 },
        );
      }
      mayRelease = true;
    }
  }
  if (!mayRelease) count("answered.unverified_read", 1, { orgId: viewer.org?.id ?? null });

  const client = await getRestClient();
  if (!client) return NextResponse.json({ answeredLeadId: null });

  const statuses = await Promise.all(
    list.map(async (leg) => {
      try {
        const c = await client.calls(leg.sid).fetch();
        return { leadId: leg.leadId, sid: leg.sid, status: c.status };
      } catch {
        return { leadId: leg.leadId, sid: leg.sid, status: "unknown" };
      }
    }),
  );

  const { answeredLeadId, done, release } = resolveAnswer(statuses);

  // Release the still-ringing losing legs so only the winner stays bridged —
  // but ONLY for a caller whose ownership of the room was verified.
  if (release.length && mayRelease)
    await Promise.all(
      release.map((sid) =>
        client.calls(sid).update({ status: "completed" }).catch(() => undefined),
      ),
    );

  return NextResponse.json({ answeredLeadId, done });
}
