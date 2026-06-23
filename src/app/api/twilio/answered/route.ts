import { NextResponse } from "next/server";
import { resolveAnswer } from "@/lib/dial-answer";
import { getRestClient } from "@/lib/twilio";

export const dynamic = "force-dynamic";

interface Leg {
  leadId: string;
  sid: string | null;
}

/**
 * Connect detection for human (conference) calls — serverless-safe.
 *
 * The browser sends the placed homeowner leg(s); we read their live status from
 * Twilio (the shared source of truth) rather than from in-memory state that a
 * different serverless instance may not hold. Returns the first answered
 * (in-progress) leg and releases the other still-ringing legs so only the winner
 * is bridged. When every leg has ended without answering, returns `done: true`
 * so the client can wrap up. Works for both single and parallel dialing.
 */
export async function POST(req: Request) {
  const { legs } = (await req.json().catch(() => ({}))) as { legs?: Leg[] };
  const list = (legs ?? []).filter((l): l is { leadId: string; sid: string } =>
    Boolean(l && l.sid),
  );
  if (!list.length)
    return NextResponse.json({ answeredLeadId: null, done: true });

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

  // Release the still-ringing losing legs so only the winner stays bridged.
  if (release.length)
    await Promise.all(
      release.map((sid) =>
        client.calls(sid).update({ status: "completed" }).catch(() => undefined),
      ),
    );

  return NextResponse.json({ answeredLeadId, done });
}
