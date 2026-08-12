import { mergeSettings } from "@/lib/org/settings";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { getRestClient, readVerifiedTwilioForm } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Async AMD verdict callback (Twilio AsyncAmdStatusCallback), attached to
 * outbound homeowner legs by /api/twilio/call when the org opted into
 * settings.dialing.amd. AsyncAmd never delays connecting a live human — this
 * arrives out-of-band a few seconds after a pickup:
 *
 *   human            → nothing to do; the call proceeds normally.
 *   machine_start    → (Enable mode) an answering machine picked up: hang the
 *                      leg up so the rep stops listening to a greeting.
 *   machine_end_*    → (DetectMessageEnd mode, used when voicemail drop is on)
 *                      the greeting just finished: redirect the leg to a spoken
 *                      voicemail message, then hang up. TTS from
 *                      settings.dialing.voicemailMessage — no audio assets.
 *   fax / unknown    → fax gets hung up; unknown is treated as human (never
 *                      hang up on a possibly-live person).
 *
 * The verdict is also parked the same way the status webhook parks Twilio's
 * call verdict (call_records by room, else pending_call_verdicts), so the
 * eventual call record carries answered_by and reports can tell voicemail
 * pickups from human connects.
 *
 * Race to accept: on a parallel dial the browser may have already declared a
 * machine leg the "winner" and released the others before this verdict lands
 * (~4s after pickup). The round is lost either way — without AMD the rep
 * would have spent 30s listening to the greeting and dispositioning by hand;
 * with it the leg self-disposes in seconds.
 */

const MACHINE_HANGUP = new Set(["machine_start", "fax"]);
const isMachineEnd = (v: string) => v.startsWith("machine_end");

const escapeXml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export async function POST(req: Request) {
  // Same guard as the status webhook — the signature covers the query string,
  // so room/org can't be forged.
  const form = await readVerifiedTwilioForm(req);
  if (!form) return new Response(null, { status: 403 });

  const url = new URL(req.url);
  const room = url.searchParams.get("room") ?? "";
  const orgId = url.searchParams.get("org") ?? "";
  const callSid = String(form.CallSid ?? "");
  const answeredBy = String(form.AnsweredBy ?? "").toLowerCase();

  // Twilio parses callback responses as TwiML — always end with an empty 204.
  if (!callSid || !answeredBy) return new Response(null, { status: 204 });

  // Park the verdict first (best-effort): the call record is only written at
  // disposition time, so this usually lands in pending_call_verdicts and is
  // claimed by insertCallRecord — the exact dance the status webhook does.
  if (isAdminConfigured() && room) {
    try {
      const admin = createAdminClient();
      const { data: updated } = await admin
        .from("call_records")
        .update({ answered_by: answeredBy })
        .eq("room", room)
        .select("id");
      if (!updated || updated.length === 0) {
        await admin
          .from("pending_call_verdicts")
          .upsert({ room, answered_by: answeredBy }, { onConflict: "room" });
      }
    } catch {
      /* best-effort */
    }
  }

  const machine = MACHINE_HANGUP.has(answeredBy) || isMachineEnd(answeredBy);
  if (!machine) return new Response(null, { status: 204 }); // human / unknown

  const client = await getRestClient();
  if (!client) return new Response(null, { status: 204 });

  // Voicemail drop only makes sense at the greeting's end (machine_end_*) —
  // dropping a message over a still-playing greeting records garbage.
  let dropMessage: string | null = null;
  if (isMachineEnd(answeredBy) && isAdminConfigured() && orgId) {
    try {
      const admin = createAdminClient();
      const { data: org } = await admin
        .from("organizations")
        .select("name, settings")
        .eq("id", orgId)
        .maybeSingle();
      if (org) {
        const settings = mergeSettings(org.settings);
        if (settings.dialing.voicemailDrop) {
          const orgName = String(org.name ?? "").trim();
          const configured = settings.dialing.voicemailMessage.trim();
          dropMessage =
            configured.replace(/\{org\}/gi, orgName || "our team") ||
            `${orgName ? `This is a courtesy call from ${orgName}. ` : ""}Sorry we missed you — we'll try to reach you another time. Thank you!`;
        }
      }
    } catch {
      /* settings unavailable → fall through to a plain hangup */
    }
  }

  try {
    if (dropMessage) {
      // Redirect the machine leg out of the conference to the spoken message.
      // On a single dial the conference has endConferenceOnExit=true, so this
      // also releases the rep back to wrap-up — which is the point.
      await client.calls(callSid).update({
        twiml: `<?xml version="1.0" encoding="UTF-8"?><Response><Pause length="1"/><Say>${escapeXml(dropMessage)}</Say><Hangup/></Response>`,
      });
    } else {
      await client.calls(callSid).update({ status: "completed" });
    }
  } catch {
    // 21220 "call not in progress" — the leg already ended (homeowner's
    // machine hung up first, or a parallel loser-release beat us). Fine.
  }

  return new Response(null, { status: 204 });
}
