import { NextResponse } from "next/server";
import { findRecentLegs, parseDialTargets } from "@/lib/dialer/recover-legs";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * "Did my dial actually go out?"
 *
 * The dialer places calls through `/api/twilio/call`, which answers with the leg
 * SIDs it created. Everything downstream — bridging the rep in, polling for the
 * answer, hanging the legs up again — depends on that one response body getting
 * back to the browser. When it doesn't, the rep's dialer concluded nothing had
 * been dialed and dropped straight back to idle, while the homeowner's phone
 * went on ringing a conference nobody would ever join.
 *
 * This is the second source of truth. Given the numbers the client tried to
 * dial, it reports the legs Twilio actually has in flight for them, so a lost
 * response costs the rep a second, not the call.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.user) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { leads?: unknown };
  const targets = parseDialTargets(body.leads);
  if (!targets.length) return NextResponse.json({ calls: [] });

  const legs = await findRecentLegs(targets);
  return NextResponse.json({
    calls: legs.map((l) => ({ leadId: l.leadId, sid: l.sid })),
  });
}
