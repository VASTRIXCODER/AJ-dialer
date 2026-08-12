import { NextResponse } from "next/server";
import { getViewer } from "@/lib/org/membership";
import { getPublicBaseUrl, getRestClient, isRestConfigured } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Hold or unhold the homeowner participant(s) in a Twilio conference.
 * When held, Twilio calls the hold-music endpoint and plays hold music to the
 * homeowner while the rep is still in the conference (muted to the homeowner).
 *
 * Body: { room: string, sids: string[], hold: boolean }
 *   room  — the conference friendly name (e.g. "hc-h-abc123")
 *   sids  — outbound call SIDs for the homeowner legs to hold/unhold
 *   hold  — true = put on hold, false = resume
 */
export async function POST(req: Request) {
  if (!isRestConfigured()) {
    return NextResponse.json({ ok: false, error: "Twilio not configured" }, { status: 503 });
  }

  // AUTH: this route had no check, so anyone who guessed a conference room name
  // could hold/unhold a live rep<->customer call (a DoS on in-progress calls) or
  // make it play hold music mid-pitch. Require a signed-in user.
  const viewer = await getViewer();
  if (!viewer.user) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    room?: string;
    sids?: string[];
    hold?: boolean;
  };

  const room = body.room?.trim();
  const sids = (body.sids ?? []).filter(Boolean);
  const hold = body.hold ?? true;

  if (!room) {
    return NextResponse.json({ ok: false, error: "room is required" }, { status: 400 });
  }

  const client = await getRestClient();
  if (!client) {
    return NextResponse.json({ ok: false, error: "Twilio unavailable" }, { status: 503 });
  }

  try {
    // Find the active conference by its friendly name.
    const conferences = await client.conferences.list({
      friendlyName: room,
      status: "in-progress",
      limit: 1,
    });

    if (!conferences.length) {
      return NextResponse.json({ ok: false, error: "Conference not found" }, { status: 404 });
    }

    const confSid = conferences[0].sid;
    const base = getPublicBaseUrl(req);
    const holdUrl = base ? `${base}/api/twilio/hold-music` : undefined;

    if (sids.length) {
      // Hold/unhold the specific homeowner call SIDs.
      await Promise.all(
        sids.map((sid) =>
          client
            .conferences(confSid)
            .participants(sid)
            .update(
              hold
                ? { hold: true, ...(holdUrl ? { holdUrl, holdMethod: "GET" } : {}) }
                : { hold: false },
            )
            .catch((err: Error) =>
              console.error(`[twilio/hold] participant ${sid}:`, err.message),
            ),
        ),
      );
    } else {
      // No specific SIDs: hold/unhold all non-coach participants.
      const participants = await client.conferences(confSid).participants.list();
      await Promise.all(
        participants
          .filter((p) => !p.coaching)
          .map((p) =>
            client
              .conferences(confSid)
              .participants(p.callSid)
              .update(
                hold
                  ? { hold: true, ...(holdUrl ? { holdUrl, holdMethod: "GET" } : {}) }
                  : { hold: false },
              )
              .catch((err: Error) =>
                console.error(`[twilio/hold] participant ${p.callSid}:`, err.message),
              ),
          ),
      );
    }

    return NextResponse.json({ ok: true, hold, room, confSid });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[twilio/hold]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
