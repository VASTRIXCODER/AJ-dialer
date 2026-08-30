import {
  addToDnc,
  CUSTOMER_REVERSIBLE_SOURCES,
  removeFromDnc,
} from "@/lib/db/dnc";
import { recordConsent } from "@/lib/db/consent";
import {
  cancelPendingMessagesForPhone,
  ensureThread,
  recordInboundMessage,
  resolveLeadForInbound,
} from "@/lib/db/messages";
import { suppressOpportunitiesForPhone } from "@/lib/db/opportunities";
import { emitOrchestrationEvent } from "@/lib/orchestration/events";
import { orgIdForCallerId } from "@/lib/org/membership";
import { readVerifiedTwilioForm } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Inbound SMS.
 *
 * THE ORDER OF THIS FUNCTION IS LOAD-BEARING:
 *
 *   1. verify the signature
 *   2. extract
 *   3. resolve the receiving org
 *   4. HANDLE STOP/START — first, unconditionally, and before anything that
 *      could throw
 *   5. persist the message and thread it — inside a try/catch that can never
 *      prevent an opt-out from having landed
 *
 * Step 4 comes before step 5 on purpose. Threading involves several reads and
 * writes, any of which could fail; the opt-out is the one thing in this route
 * that has a legal deadline attached to it, so it must not be downstream of
 * anything optional.
 *
 * THE 10DLC TRAP: with a Messaging Service and Advanced Opt-Out enabled — the
 * common configuration, and this account's A2P is already registered — Twilio
 * intercepts STOP and MAY NEVER FORWARD IT HERE, while silently blocking
 * subsequent sends with error 21610. The drain therefore treats 21610 as an
 * authoritative opt-out in its own right. Whether Advanced Opt-Out is on is a
 * decision that has to be made and written down, not discovered later.
 *
 * Each dialing number's Messaging webhook must point at {app}/api/twilio/sms.
 * As of this writing they point at ElevenLabs, which 404s every inbound SMS
 * including STOP — which is why `dnc_numbers` contains zero rows sourced from
 * a text message in the platform's entire history.
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
  const raw = String(form.Body ?? "");
  const text = raw.trim().toLowerCase();
  const sid = String(form.MessageSid ?? form.SmsSid ?? "") || null;
  if (!from) return twiml();

  const isStop = STOP_WORDS.has(text);
  const isStart = START_WORDS.has(text);

  // Route to the org that owns the receiving number. If none claims it (a shared
  // platform number), still send a compliant acknowledgement.
  const orgId = await orgIdForCallerId(to);

  // ── 4. Compliance first, before anything optional. ────────────────────────
  if (isStop && orgId) {
    // Suppression FIRST and on its own — the legally required half must not be
    // able to fail because of anything that follows it.
    await addToDnc({ orgId, phone: from, reason: "Inbound SMS STOP", source: "sms_stop" });

    // Cancel anything already approved and waiting. This is the ONLY mechanism
    // that catches a message a human already approved: stop rules run on the
    // next orchestration tick and the send-time re-gate runs at the drain, and
    // both are too late if the drain fires in the next few seconds.
    try {
      await cancelPendingMessagesForPhone({
        orgId,
        phone: from,
        reason: "They replied STOP.",
      });
    } catch {
      /* the suppression above already stands on its own */
    }

    // Stop the automation. addToDnc only writes the suppression list, which
    // stops future dials; a running playbook reads the opportunity's stage, so
    // without this a customer who just said stop keeps generating escalations
    // and call tasks.
    try {
      await suppressOpportunitiesForPhone({ orgId, phone: from, reason: "sms_stop" });
    } catch {
      /* likewise */
    }

    // The withdrawal goes in the ledger too. dnc_numbers records THAT they are
    // suppressed; the ledger records that they asked, when, and in whose words
    // — which is what you produce when someone disputes it.
    try {
      await recordConsent({
        orgId,
        phone: from,
        channel: "sms",
        action: "revoked",
        scope: "transactional",
        source: "inbound_sms",
        evidence: raw.slice(0, 200),
      });
    } catch {
      /* never allowed to block the opt-out */
    }
  }

  if (isStart && orgId) {
    // Opt back in — but only from a texting opt-out. "YES" is a START word, and
    // it must not re-open dialing on someone a rep marked Do Not Call on a call.
    await removeFromDnc(orgId, from, { onlySources: CUSTOMER_REVERSIBLE_SOURCES });
    // TRANSACTIONAL only, never promotional. They asked us to stop ignoring
    // them; they did not ask for marketing, and a one-word reply is not the
    // affirmative express consent a promotional send requires.
    try {
      await recordConsent({
        orgId,
        phone: from,
        channel: "sms",
        action: "granted",
        scope: "transactional",
        source: "inbound_sms",
        evidence: raw.slice(0, 200),
      });
    } catch {
      /* the un-suppression above already stands on its own */
    }
  }

  // ── 5. Persist and thread. EVERY inbound message, including STOP bodies:
  //       the customer's own words are the evidence of what they asked for,
  //       and discarding them because the keyword was already handled would
  //       throw away the only record of what was actually said.
  if (orgId && raw.trim()) {
    try {
      const match = await resolveLeadForInbound(orgId, from);
      const thread = await ensureThread({
        orgId,
        phone: from,
        leadId: match.leadId,
        opportunityId: match.opportunityId,
        // The number they texted becomes this conversation's sticky sender, so
        // our reply comes from the number they already know.
        senderNumber: to || null,
        ambiguousMatch: match.ambiguous,
      });
      if (thread) {
        const stored = await recordInboundMessage({
          orgId,
          threadId: thread.id,
          leadId: match.leadId,
          opportunityId: match.opportunityId,
          fromNumber: from,
          toNumber: to,
          body: raw.slice(0, 1600),
          providerSid: sid,
        });
        // The emitter for `message.received`. It fires only for a NEW message
        // (a Twilio webhook retry returns false on the provider_sid dedupe),
        // and never for STOP — a playbook must not be activated by someone
        // asking us to leave them alone.
        if (stored && match.leadId && !isStop) {
          await emitOrchestrationEvent({
            orgId,
            leadId: match.leadId,
            event: "message.received",
            touch: { direction: "inbound", channel: "sms" },
          });
        }
      }
    } catch {
      /* An inbound we failed to file is a lost message, not a failed opt-out. */
    }
  }

  if (isStop) {
    return twiml(
      "You have been unsubscribed and will no longer be contacted. Reply START to opt back in.",
    );
  }
  if (isStart) return twiml("You have been re-subscribed.");
  // Everything else is filed and answered by a human. No auto-reply: an
  // automatic response to a real question is worse than a slightly slower one.
  return twiml();
}
