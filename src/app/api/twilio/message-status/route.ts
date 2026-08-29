import { canAdvanceStatus, statusFromProvider, timestampColumnFor } from "@/lib/messaging/status";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { readVerifiedTwilioForm } from "@/lib/twilio";

export const dynamic = "force-dynamic";

/**
 * Delivery receipts.
 *
 * This route is the ONLY writer of `sent` and `delivered`. A send call
 * returning means Twilio has the message, not that anyone received it, and a
 * product that conflates the two tells its users every message landed.
 *
 * Twilio does not guarantee callback ORDER, so a `sent` receipt genuinely
 * arrives after `delivered`. Every write is a ranked compare-and-set: a
 * transition is applied only when it is forward progress, and a late receipt
 * becomes a no-op instead of a downgrade.
 *
 * Twilio also does not REPLAY receipts. Anything sent before this route existed
 * has its delivery outcome lost permanently — which is why pointing the
 * statusCallback here has to happen before the first send, not after.
 */
export async function POST(req: Request) {
  const form = await readVerifiedTwilioForm(req);
  if (!form) return new Response(null, { status: 403 });

  const sid = String(form.MessageSid ?? form.SmsSid ?? "");
  const providerStatus = String(form.MessageStatus ?? form.SmsStatus ?? "");
  if (!sid || !providerStatus || !isAdminConfigured()) {
    // Nothing to record. 204 rather than an error: Twilio retries on 5xx, and
    // retrying a callback we cannot use just costs both sides requests.
    return new Response(null, { status: 204 });
  }

  const next = statusFromProvider(providerStatus);
  if (!next) return new Response(null, { status: 204 });

  try {
    const admin = createAdminClient();
    // Located by provider_sid, which is globally unique — the message may
    // belong to any org and the callback carries no org context.
    const { data: row } = await admin
      .from("messages")
      .select("id, status, org_id")
      .eq("provider_sid", sid)
      .maybeSingle();
    if (!row) return new Response(null, { status: 204 });

    const current = String(row.status ?? "");
    // Provider truth is recorded whatever happens, because it is a fact about
    // the carrier even when it does not move our own lifecycle.
    const patch: Record<string, unknown> = {
      provider_status: providerStatus,
      updated_at: new Date().toISOString(),
    };
    if (form.ErrorCode) patch.error_code = String(form.ErrorCode);
    if (form.ErrorMessage) patch.error_message = String(form.ErrorMessage);

    if (canAdvanceStatus(current, next)) {
      patch.status = next;
      const column = timestampColumnFor(next);
      if (column) patch[column] = new Date().toISOString();
    }

    await admin
      .from("messages")
      .update(patch)
      .eq("id", String(row.id))
      // CAS on the status we read, so two receipts racing cannot interleave
      // into a state neither of them intended.
      .eq("status", current);

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}
