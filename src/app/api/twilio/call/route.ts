import { NextResponse } from "next/server";
import { getRestClient, isRestConfigured, twilioConfig } from "@/lib/twilio";
import { toE164 } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * Initiates outbound calls for parallel ("3X") dialing.
 *
 * Production pattern: each lead is dialed into the agent's conference room. The
 * first homeowner to answer is bridged to the agent and the remaining legs are
 * canceled. This route places the outbound legs; the conference/bridge wiring
 * lives in the TwiML returned per call.
 *
 * In demo mode it returns simulated call SIDs so the UI flow is exercised
 * without a Twilio account.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    numbers?: string[];
    agentIdentity?: string;
  };
  const numbers = (body.numbers ?? []).map(toE164).filter(Boolean);

  if (!numbers.length) {
    return NextResponse.json({ error: "No numbers provided" }, { status: 400 });
  }

  if (!isRestConfigured()) {
    return NextResponse.json({
      mode: "demo",
      calls: numbers.map((to, i) => ({
        to,
        sid: `CA_demo_${Date.now().toString(36)}_${i}`,
        status: "queued",
      })),
    });
  }

  const client = await getRestClient();
  if (!client) {
    return NextResponse.json({ mode: "demo", calls: [] });
  }

  const room = `agent-${body.agentIdentity ?? "floor"}-${Date.now().toString(36)}`;
  const base = twilioConfig.appUrl;

  const calls = await Promise.all(
    numbers.map(async (to) => {
      try {
        const call = await client.calls.create({
          to,
          from: twilioConfig.callerId,
          // Each answered lead joins the agent's conference; the app connects
          // the first to answer and drops the rest.
          twiml: `<Response><Dial answerOnBridge="true"><Conference startConferenceOnEnter="true" endConferenceOnExit="true" waitUrl="">${room}</Conference></Dial></Response>`,
          statusCallback: `${base}/api/twilio/status`,
          statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
        });
        return { to, sid: call.sid, status: call.status };
      } catch (err) {
        return { to, sid: null, status: "failed", error: String(err) };
      }
    }),
  );

  return NextResponse.json({ mode: "live", room, calls });
}
