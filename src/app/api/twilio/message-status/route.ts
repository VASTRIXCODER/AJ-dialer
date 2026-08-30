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

    // Provider truth is a fact about the carrier whether or not it moves our
    // own lifecycle, so it is written UNCONDITIONALLY and without a CAS. It
    // used to ride the same compare-and-set as the status, which meant a
    // receipt that lost the race threw away its error code too — exactly the
    // A2P deliverability signal this feature exists to surface.
    const truth: Record<string, unknown> = {
      provider_status: providerStatus,
      updated_at: new Date().toISOString(),
    };
    if (form.ErrorCode) truth.error_code = String(form.ErrorCode);
    if (form.ErrorMessage) truth.error_message = String(form.ErrorMessage);
    await admin.from("messages").update(truth).eq("id", String(row.id));

    // Then advance the lifecycle under a CAS that is CHECKED and retried.
    //
    // Twilio does not order status callbacks and does not replay them, so a
    // single unchecked compare-and-set silently lost whichever receipt arrived
    // second — permanently. A `delivered` losing to a concurrent `sent` left
    // the message reporting no confirmation forever; an `undelivered` losing
    // left a failed message reading as a clean success.
    //
    // This is the discipline calls/apply-event.ts already uses: select the
    // affected row, and on a miss re-read and re-decide rather than assume.
    let current = String(row.status ?? "");
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!canAdvanceStatus(current, next)) {
        // Not a loss — the row is already at or past this receipt. Nothing to
        // do, and nothing lost, because provider truth landed above.
        return new Response(null, { status: 204 });
      }
      const patch: Record<string, unknown> = { status: next, updated_at: new Date().toISOString() };
      const column = timestampColumnFor(next);
      if (column) patch[column] = new Date().toISOString();

      const { data: moved } = await admin
        .from("messages")
        .update(patch)
        .eq("id", String(row.id))
        .eq("status", current)
        .select("id");
      if (Array.isArray(moved) && moved.length > 0) break;

      // Lost the race. Re-read and decide again against what is actually there.
      const { data: fresh } = await admin
        .from("messages")
        .select("status")
        .eq("id", String(row.id))
        .maybeSingle();
      if (!fresh) break;
      current = String(fresh.status ?? "");
    }

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}
