import { NextResponse } from "next/server";
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

  const { sids } = (await req.json().catch(() => ({}))) as { sids?: unknown };
  const list = (Array.isArray(sids) ? sids : [])
    .map((s) => String(s ?? "").trim())
    // Twilio call SIDs are "CA" + 32 hex characters — anything else is noise.
    .filter((s) => /^CA[0-9a-fA-F]{32}$/.test(s))
    .slice(0, 10);

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
