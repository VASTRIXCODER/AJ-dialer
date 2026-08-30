import "server-only";

import { getOrgById } from "../org/membership";
import { buildSendContext, isMessagingPaused, judgeSend } from "../db/messages";
import { recordConsent } from "../db/consent";
import { addToDnc } from "../db/dnc";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { count, timing } from "../telemetry";
import { isDeferrable, primaryDenial, type SendDenial } from "./send-gate";
import {
  isOptOutError,
  isRetryableError,
  messageStatusCallbackUrl,
  sendMessage,
} from "./transport";

// ─────────────────────────────────────────────────────────────────────────────
// The send drain: the only code path that hands a message to a carrier.
//
// THE RE-GATE IS THE WHOLE POINT. Every message is judged again here,
// immediately before the provider call, against freshly read DNC, consent and
// caps. The window between a human approving a message and Twilio accepting it
// is exactly where an opt-out lands, and a gate that only ran at proposal time
// would text people who had asked us to stop in the meantime.
//
// A message that passes at proposal and fails here becomes `blocked`, never
// `failed`. And a stuck `sending` row is NEVER reclaimed: Twilio's Messages API
// has no idempotency key, so a reclaim is a second real text to a real person.
// Those rows go to `needs_review` for a human to resolve against the provider.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

/** Per tick. Small: the cron runs every minute and pacing is a feature. */
const BATCH = 20;
const MAX_ATTEMPTS = 4;

export interface DrainReport {
  claimed: number;
  sent: number;
  blocked: number;
  deferred: number;
  failed: number;
  paused: boolean;
  /** Reasons that blocked something this tick, for the operator's readout. */
  blockedReasons: string[];
}

export async function drainMessages(now = new Date()): Promise<DrainReport> {
  const report: DrainReport = {
    claimed: 0,
    sent: 0,
    blocked: 0,
    deferred: 0,
    failed: 0,
    paused: false,
    blockedReasons: [],
  };
  if (!isAdminConfigured()) return report;
  const started = Date.now();
  const admin = createAdminClient();

  try {
    // Kill switch first, before anything is claimed. Claiming and then
    // refusing would burn an attempt on every message, every minute, and
    // eventually exhaust MAX_ATTEMPTS on a queue nobody meant to destroy.
    if (await isMessagingPaused()) {
      report.paused = true;
      return report;
    }

    const { data: claimed } = await admin.rpc("app_claim_messages", { p_limit: BATCH });
    const rows = (claimed ?? []) as Row[];
    report.claimed = rows.length;
    if (!rows.length) return report;

    // Orgs resolved once per tick rather than once per message.
    const orgIds = [...new Set(rows.map((r) => s(r.org_id)).filter(Boolean))];
    const orgs = new Map(
      await Promise.all(orgIds.map(async (id) => [id, await getOrgById(id)] as const)),
    );

    for (const row of rows) {
      const id = s(row.id);
      const orgId = s(row.org_id);
      const to = s(row.to_number);
      const from = s(row.from_number);
      const body = s(row.body);
      const scope = s(row.scope) === "promotional" ? "promotional" : "transactional";
      const attempts = Number(row.attempts ?? 1) || 1;

      // Read the lead's stored timezone, so quiet hours bracket against the
      // same two candidates the proposal used.
      let leadTz: string | null = null;
      if (row.lead_id) {
        const { data: lead } = await admin
          .from("leads")
          .select("timezone")
          .eq("id", s(row.lead_id))
          .maybeSingle();
        leadTz = lead?.timezone ? s(lead.timezone) : null;
      }

      const ctx = await buildSendContext({
        org: orgs.get(orgId) ?? null,
        orgId,
        toPhone: to,
        senderNumber: from,
        leadTimezone: leadTz,
        now,
      });
      const verdict = judgeSend(ctx, {
        now,
        body,
        requiredScope: scope,
        // The row is claimed, so it HAS an approver — the constraint
        // guarantees it. Passing it through keeps the gate's one shape.
        approvedBy: s(row.approved_by) || null,
      });

      if (!verdict.allowed) {
        const reasons = verdict.denials;
        if (verdict.deferUntil) {
          // Everything blocking it is a hold. Put it back with a time, still
          // `approved` — a deferred message has NOT lost its approval.
          await admin
            .from("messages")
            .update({
              status: "approved",
              next_attempt_at: verdict.deferUntil.toISOString(),
              blocked_reasons: reasons,
              updated_at: new Date().toISOString(),
            })
            .eq("id", id);
          report.deferred += 1;
          continue;
        }
        await blockMessage(admin, id, reasons);
        report.blocked += 1;
        for (const r of reasons) {
          if (!report.blockedReasons.includes(r)) report.blockedReasons.push(r);
        }
        count("messaging.blocked", 1, { orgId, reason: primaryDenial(reasons) ?? "unknown" });
        continue;
      }

      // ── The provider call. Past this line a real text may exist. ──────────
      await admin
        .from("messages")
        .update({ status: "sending", updated_at: new Date().toISOString() })
        .eq("id", id);

      const result = await sendMessage({
        to,
        from,
        body,
        statusCallbackUrl: messageStatusCallbackUrl(),
      });

      if (result.ok) {
        await admin
          .from("messages")
          .update({
            // NOT `sent`. Twilio answered "we have it", and only a delivery
            // receipt may say more than that.
            status: "sending",
            provider_sid: result.providerSid ?? null,
            provider_status: result.providerStatus ?? null,
            segments: result.segments ?? null,
            queued_at: new Date().toISOString(),
            // No reachable callback origin means no receipt will ever arrive.
            // Flag it rather than leaving a row that looks stuck forever.
            ...(result.noReceipts ? { status: "needs_review" } : {}),
            error_message: result.noReceipts
              ? "Sent, but no delivery receipts will arrive: no public callback URL is configured."
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id);
        await admin
          .from("message_threads")
          .update({ last_outbound_at: new Date().toISOString() })
          .eq("id", s(row.thread_id));
        report.sent += 1;
        continue;
      }

      // Twilio 21610 means they opted out of this sender. With a Messaging
      // Service using Advanced Opt-Out, Twilio intercepts STOP and may never
      // forward it to our webhook — so for those accounts this error is the
      // ONLY signal the opt-out ever happened, and it is authoritative.
      if (isOptOutError(result.errorCode)) {
        await blockMessage(admin, id, ["consent_revoked"], result.error);
        report.blocked += 1;
        await addToDnc({
          orgId,
          phone: to,
          reason: "Carrier reported an opt-out (Twilio 21610)",
          source: "twilio_opt_out",
        });
        await recordConsent({
          orgId,
          phone: to,
          channel: "sms",
          action: "revoked",
          scope: "transactional",
          source: "inbound_sms",
          evidence: "The carrier rejected the message because they had opted out (Twilio 21610).",
          evidenceRef: id,
        });
        count("messaging.carrier_opt_out", 1, { orgId });
        continue;
      }

      const retryable = isRetryableError(result.errorCode) && attempts < MAX_ATTEMPTS;
      await admin
        .from("messages")
        .update({
          status: retryable ? "approved" : "failed",
          error_code: result.errorCode ?? null,
          error_message: result.error ?? null,
          // Exponential-ish backoff: 1, 4, 9 minutes.
          next_attempt_at: retryable
            ? new Date(now.getTime() + attempts * attempts * 60_000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (!retryable) report.failed += 1;
      count("messaging.send_fail", 1, { orgId, code: result.errorCode ?? "unknown" });
    }

    return report;
  } catch {
    count("messaging.drain_fail", 1);
    return report;
  } finally {
    // In a finally, for the same reason the orchestration heartbeat is: the
    // two most common ticks return early, and their silence would otherwise be
    // indistinguishable from a cron that was never scheduled.
    try {
      await admin
        .from("app_settings")
        .update({ messaging_last_tick_at: new Date().toISOString() })
        .eq("id", "global");
    } catch {
      /* the heartbeat is diagnostics, never load-bearing */
    }
    timing("messaging.drain_ms", Date.now() - started);
  }
}

async function blockMessage(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  reasons: SendDenial[],
  error?: string,
): Promise<void> {
  await admin
    .from("messages")
    .update({
      status: "blocked",
      blocked_reasons: reasons,
      error_message: error ?? null,
      next_attempt_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * Rows stuck in `sending` past a grace period.
 *
 * They are NEVER reclaimed and re-sent. Twilio's Messages API has no
 * idempotency key, so "retrying" a message that may already have gone is how a
 * customer receives the same text twice. The honest resolution is to ask Twilio
 * what happened using the provider_sid — which is why the sid is written before
 * anything else — and until someone does, the row sits in `needs_review` where
 * it is visible rather than silently pretending to be in flight.
 */
export async function flagStuckMessages(olderThanMinutes = 15): Promise<number> {
  if (!isAdminConfigured()) return 0;
  try {
    const admin = createAdminClient();
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
    const { data } = await admin
      .from("messages")
      .update({
        status: "needs_review",
        error_message:
          "Stuck mid-send. Not retried: a second attempt would risk sending the same message twice. Check the provider for its real outcome.",
        updated_at: new Date().toISOString(),
      })
      .eq("status", "sending")
      .lt("updated_at", cutoff)
      .select("id");
    const n = (data ?? []).length;
    if (n) count("messaging.stuck_flagged", n);
    return n;
  } catch {
    return 0;
  }
}

export { isDeferrable };
