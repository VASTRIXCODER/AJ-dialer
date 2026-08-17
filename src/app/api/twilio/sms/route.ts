import { addToDnc, removeFromDnc } from "@/lib/db/dnc";
import { orgIdForCallerId } from "@/lib/org/membership";
import { readVerifiedTwilioForm } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Inbound SMS webhook. Its whole job is compliance: honor an opt-out (STOP and
 * friends) by writing the sender's number to the receiving org's Do-Not-Call
 * list, and an opt-in (START) by removing it. Everything else is ignored.
 *
 * Point each dialing number's Messaging webhook at {app}/api/twilio/sms (the
 * superadmin "provision numbers" action does this). error.txt shows the symptom
 * of NOT doing this: the number's Messaging webhook was left pointing at
 * ElevenLabs, which 404s every inbound SMS — including STOP.
 */
const STOP_WORDS = new Set([
  "stop", "stopall", "stop all", "unsubscribe", "cancel", "end", "quit", "revoke",
]);
const START_WORDS = new Set(["start", "yes", "unstop", "continue"]);

function twiml(message?: string): Response {
  const escaped = (message ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const body = message ? `<Message>${escaped}</Message>` : "";
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`,
    { headers: { "content-type": "text/xml" } },
  );
}

export async function POST(req: Request) {
  // Verify Twilio's signature before acting (same guard as the status webhook).
  const form = await readVerifiedTwilioForm(req);
  if (!form) return new Response(null, { status: 403 });

  const from = String(form.From ?? "");
  const to = String(form.To ?? "");
  const text = String(form.Body ?? "").trim().toLowerCase();
  if (!from || !text) return twiml();

  const isStop = STOP_WORDS.has(text);
  const isStart = START_WORDS.has(text);
  if (!isStop && !isStart) return twiml(); // not an opt-out / opt-in keyword

  // Route to the org that owns the receiving number. If none claims it (a shared
  // platform number), still send a compliant acknowledgement.
  const orgId = await orgIdForCallerId(to);

  if (isStop) {
    if (orgId) {
      await addToDnc({ orgId, phone: from, reason: "Inbound SMS STOP", source: "sms_stop" });
    }
    return twiml(
      "You have been unsubscribed and will no longer be contacted. Reply START to opt back in.",
    );
  }

  // START / opt back in.
  if (orgId) await removeFromDnc(orgId, from);
  return twiml("You have been re-subscribed.");
}
