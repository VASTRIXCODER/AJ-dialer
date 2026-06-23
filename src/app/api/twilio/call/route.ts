import { NextResponse } from "next/server";
import { registerRoom } from "@/lib/call-registry";
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
  const leads = (body.leads ?? [])
    .map((l) => ({ leadId: l.leadId, to: toE164(l.phone) }))
    .filter((l) => l.to && l.leadId);

  if (!room || !leads.length) {
    return NextResponse.json(
      { error: "room and at least one lead are required" },
      { status: 400 },
    );
  }

  const client = await getRestClient();
  if (!client) {
    return NextResponse.json({ error: "Twilio unavailable" }, { status: 503 });
  }

  // Only attach a StatusCallback when we have a publicly-reachable origin —
  // an unreachable/relative URL makes Twilio reject the request (21609 / 11200).
  // The status callback drives parallel auto-release; without it the call still
  // connects, it just won't auto-cancel the losing legs.
  const base = getPublicBaseUrl(req);

  // For a single call, the homeowner hanging up should end the call (matching a
  // direct dial). For parallel, the losing legs are force-released, so they must
  // NOT end the conference on exit — only the rep's leg does that.
  const endOnExit = leads.length === 1 ? "true" : "false";
  const conferenceTwiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Dial><Conference startConferenceOnEnter="true" endConferenceOnExit="${endOnExit}" beep="false">${room}</Conference></Dial></Response>`;

  const placed = await Promise.all(
    leads.map(async (leg) => {
      try {
        const call = await client.calls.create({
          to: leg.to,
          from: twilioConfig.callerId,
          twiml: conferenceTwiml,
          timeout: 30,
          ...(base
            ? {
                statusCallback: `${base}/api/twilio/status?room=${encodeURIComponent(room)}&leadId=${encodeURIComponent(leg.leadId)}`,
                statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
              }
            : {}),
        });
        return { leadId: leg.leadId, to: leg.to, sid: call.sid };
      } catch {
        return { leadId: leg.leadId, to: leg.to, sid: null };
      }
    }),
  );

  registerRoom(room, placed);

  return NextResponse.json({ room, calls: placed });
}
