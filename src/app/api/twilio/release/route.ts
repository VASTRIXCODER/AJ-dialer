import { NextResponse } from "next/server";
import {
  findRecentLegs,
  orgCallerIdSet,
  parseDialTargets,
} from "@/lib/dialer/recover-legs";
import { getViewer } from "@/lib/org/membership";
import { getRestClient } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Hang up outbound legs the dialer placed but can no longer bridge.
 *
 * The manual dialer rings the homeowner FIRST and only then joins the rep's
 * browser into the conference. When that second step fails — a blocked
 * microphone, a wedged Voice device — the rep drops back to idle while the
 * homeowner's phone keeps ringing an empty room. That's an abandoned call, so
 * the client calls this to cancel the legs it just placed.
 *
 * Callers pass the SIDs when they have them, and the numbers they dialed when
 * they don't. That second path is not a nicety: the SIDs only exist in the
 * browser if `/api/twilio/call`'s response survived the trip back to it, and the
 * case we most need to clean up after is exactly the one where it didn't.
 *
 * Twilio only accepts `completed` on a call that is still queued/ringing/live;
 * a leg that already ended errors, which is fine — each SID is best-effort and
 * failures never fail the request.
 */
export async function POST(req: Request) {
  // Signed-in only. The SIDs come from the caller, so this must never be an
  // open "hang up any call on the account" endpoint.
  const viewer = await getViewer();
  if (!viewer.user) {
    return NextResponse.json({ error: "Not authorized" }, { status: 401 });
  }

  const { sids, leads } = (await req.json().catch(() => ({}))) as {
    sids?: unknown;
    leads?: unknown;
  };
  const list = (Array.isArray(sids) ? sids : [])
    .map((s) => String(s ?? "").trim())
    // Twilio call SIDs are "CA" + 32 hex characters — anything else is noise.
    .filter((s) => /^CA[0-9a-fA-F]{32}$/.test(s))
    .slice(0, 10);

  // No SIDs — resolve them from the numbers instead. findRecentLegs only ever
  // returns legs created seconds ago and still in flight, so this stays scoped
  // to the caller's own dial rather than becoming a way to end any call.
  if (!list.length) {
    const targets = parseDialTargets(leads);
    if (targets.length) {
      // Scope recovery to legs placed from THIS org's own caller IDs, so it can
      // only ever hang up the caller's own dial, never another tenant's live call.
      const allowedFrom = orgCallerIdSet(viewer.org?.settings?.dialing);
      for (const leg of await findRecentLegs(targets, undefined, allowedFrom)) {
        list.push(leg.sid);
      }
    }
  }

  if (!list.length) return NextResponse.json({ released: 0 });

  const client = await getRestClient();
  if (!client) return NextResponse.json({ released: 0 });

  const results = await Promise.all(
    list.map((sid) =>
      client
        .calls(sid)
        .update({ status: "completed" })
        .then(() => true)
        .catch(() => false),
    ),
  );

  return NextResponse.json({ released: results.filter(Boolean).length });
}
