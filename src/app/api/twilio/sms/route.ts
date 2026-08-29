import {
  addToDnc,
  CUSTOMER_REVERSIBLE_SOURCES,
  removeFromDnc,
} from "@/lib/db/dnc";
import { recordConsent } from "@/lib/db/consent";
import { suppressOpportunitiesForPhone } from "@/lib/db/opportunities";
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
      // Suppression FIRST and on its own — the legally required half must not
      // be able to fail because of anything that follows it.
      await addToDnc({ orgId, phone: from, reason: "Inbound SMS STOP", source: "sms_stop" });
      // Then stop the automation. addToDnc only writes the suppression list,
      // which stops future dials; a running playbook reads the opportunity's
      // stage, so without this a customer who just said stop keeps generating
      // escalations and call tasks. Deliberately awaited (an opt-out that only
      // half-lands is the one race worth paying for) but never allowed to throw.
      try {
        await suppressOpportunitiesForPhone({
          orgId,
          phone: from,
          reason: "sms_stop",
        });
      } catch {
        /* the suppression above already stands on its own */
      }
      // The withdrawal goes in the ledger too. dnc_numbers records THAT they
      // are suppressed; the ledger records that they asked, when, and in whose
      // words — which is what you produce when someone disputes it. Retention
      // runs five years from the request, so this row is never deleted.
      try {
        await recordConsent({
          orgId,
          phone: from,
          channel: "sms",
          action: "revoked",
          scope: "transactional",
          source: "inbound_sms",
          evidence: text.slice(0, 200),
        });
      } catch {
        /* never allowed to block the opt-out */
      }
    }
    return twiml(
      "You have been unsubscribed and will no longer be contacted. Reply START to opt back in.",
    );
  }

  // START / opt back in — but only from a texting opt-out. See
  // CUSTOMER_REVERSIBLE_SOURCES: "YES" is a START word, and it must not
  // re-open dialing on someone a rep marked Do Not Call on a call.
  if (orgId) {
    await removeFromDnc(orgId, from, { onlySources: CUSTOMER_REVERSIBLE_SOURCES });
    // START grants TRANSACTIONAL only, never promotional. They asked us to stop
    // ignoring them; they did not ask for marketing, and a one-word reply is
    // not the affirmative express consent a promotional send requires. Moving
    // to promotional takes its own capture, with its own evidence.
    try {
      await recordConsent({
        orgId,
        phone: from,
        channel: "sms",
        action: "granted",
        scope: "transactional",
        source: "inbound_sms",
        evidence: text.slice(0, 200),
      });
    } catch {
      /* the un-suppression above already stands on its own */
    }
  }
  return twiml("You have been re-subscribed.");
}
