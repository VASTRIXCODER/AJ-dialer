import { NextResponse } from "next/server";
import { registerRoom } from "@/lib/call-registry";
import { nextCallerId } from "@/lib/dialer/rotation-server";
import { getViewer } from "@/lib/org/membership";
import {
  getPublicBaseUrl,
  getRestClient,
  isRestConfigured,
  twilioConfig,
} from "@/lib/twilio";
import { toE164 } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface DialLeadInput {
  leadId: string;
  phone: string;
}

/**
 * Initiates the outbound legs for parallel ("3X") dialing.
 *
 * Each homeowner is dialed into the agent's conference `room`. The agent's
 * browser joins the same room via the Voice SDK; the first homeowner to answer
 * is bridged, and `/api/twilio/status` releases the remaining legs. The browser
 * polls `/api/twilio/answered` to learn which lead won.
 *
 * Requires Twilio REST credentials. With none configured it returns 503 so the
 * client can surface a clear "connect Twilio" state — it never simulates calls.
 */
export async function POST(req: Request) {
  if (!isRestConfigured()) {
    return NextResponse.json(
      { error: "Twilio is not configured", mode: "offline" },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    leads?: DialLeadInput[];
    room?: string;
    agentIdentity?: string;
  };

  const room = body.room?.trim();
  const rawLeads = body.leads ?? [];
  // Normalize every number; toE164 returns "" for anything not dialable, so the
  // filter drops placeholder/garbled phones before we ever hit Twilio.
  const leads = rawLeads
    .map((l) => ({ leadId: l.leadId, to: toE164(l.phone) }))
    .filter((l) => l.to && l.leadId);

  if (!room) {
    return NextResponse.json({ error: "A conference room is required" }, { status: 400 });
  }
  if (!leads.length) {
    // Distinguish "you sent nothing" from "every number was invalid" so the rep
    // gets an actionable message instead of a generic credentials warning.
    return NextResponse.json(
      {
        error: rawLeads.length
          ? "None of these leads have a valid phone number. Check the numbers on the lead(s) and re-import if needed."
          : "At least one lead is required",
      },
      { status: 400 },
    );
  }

  const client = await getRestClient();
  if (!client) {
    return NextResponse.json({ error: "Twilio unavailable" }, { status: 503 });
  }

  // Resolve the caller so manual legs rotate through the org's shared caller-ID
  // pool on THIS rep's own counter (per-rep), same as AI calls.
  const viewer = await getViewer();
  const repKey = viewer.user?.id ?? null;
  const orgSettings = viewer.org?.settings ?? null;

  // Only attach a StatusCallback when we have a publicly-reachable origin —
  // an unreachable/relative URL makes Twilio reject the request (21609 / 11200).
  // The status callback drives parallel auto-release; without it the call still
  // connects, it just won't auto-cancel the losing legs.
  const base = getPublicBaseUrl(req);

  // Custom hold/wait music: when the org configured a playlist, point the
  // conference waitUrl at our hold endpoint so the homeowner hears it (while
  // waiting / on hold) instead of Twilio's default tone. Needs a public base URL.
  const orgId = viewer.org?.id ?? null;
  const hasHoldMusic = (orgSettings?.dialing?.holdMusicUrls ?? []).length > 0;
  const waitAttr =
    base && orgId && hasHoldMusic
      ? ` waitUrl="${base.replace(/&/g, "&amp;")}/api/twilio/hold?org=${encodeURIComponent(orgId)}" waitMethod="GET"`
      : "";

  // For a single call, the homeowner hanging up should end the call (matching a
  // direct dial). For parallel, the losing legs are force-released, so they must
  // NOT end the conference on exit — only the rep's leg does that.
  const endOnExit = leads.length === 1 ? "true" : "false";
  const conferenceTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="${endOnExit}" beep="false"${waitAttr}>${room}</Conference></Dial></Response>`;

  const placed = await Promise.all(
    leads.map(async (leg) => {
      try {
        // One rotated caller ID per leg (this rep's atomic counter → distinct seq).
        const from = (await nextCallerId(repKey, orgSettings)) || twilioConfig.callerId;
        const call = await client.calls.create({
          to: leg.to,
          from,
          twiml: conferenceTwiml,
          timeout: 30,
          ...(base
            ? {
                statusCallback: `${base}/api/twilio/status?room=${encodeURIComponent(room)}&leadId=${encodeURIComponent(leg.leadId)}`,
                statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
              }
            : {}),
        });
        return { leadId: leg.leadId, to: leg.to, sid: call.sid, error: null };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[twilio/call] calls.create failed for ${leg.to}:`, msg);
        return { leadId: leg.leadId, to: leg.to, sid: null, error: msg };
      }
    }),
  );

  registerRoom(room, placed);

  // Collect errors from failed legs so the client can surface the real reason.
  const errors = placed.filter((p) => !p.sid && p.error).map((p) => p.error);
  return NextResponse.json({ room, calls: placed, errors });
}
