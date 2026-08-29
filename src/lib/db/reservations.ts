import "server-only";

import { applyCallEvent } from "@/lib/calls/apply-event";
import { rowToLead } from "@/lib/db/leads";
import { resolveLeadTimezone } from "@/lib/dialer/lead-timezone";
import { sanitizeSegments } from "@/lib/dialer/segments";
import { isWithinCallingWindow } from "@/lib/dialer/schedule";
import type { AutomationSettings } from "@/lib/org/settings";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { count } from "@/lib/telemetry";
import type { Lead } from "@/lib/types";

// ─────────────────────────────────────────────────────────────────────────────
// The reservation engine's imperative shell. Atomic claims go through the
// SECURITY DEFINER RPCs in supabase/schema.sql PART 25 (FOR UPDATE SKIP LOCKED
// — the app_claim_notifications pattern); the eligibility predicate has a pure
// TS twin in src/lib/dialer/eligibility.ts (LOCKSTEP comments on both sides).
//
// Why claims exist: before Phase 1 nothing stopped two reps — or a rep and the
// AI cron — from dialing the same lead at the same moment. A claim is a
// short-lived exclusive hold (TTL 180s, renewed by heartbeat while on-screen);
// an expired hold is simply claimable, so there is no sweeper and no orphan.
// ─────────────────────────────────────────────────────────────────────────────

export const RESERVATION_TTL_SEC = 180;
/** reserved_by for owner-less orgs (the unattended cron) — no auth.users FK. */
export const SYSTEM_RESERVER = "00000000-0000-0000-0000-000000000001";

export interface ClaimOptions {
  orgId: string;
  /** Who holds the reservation (rep id; SYSTEM_RESERVER for the cron). */
  userId: string;
  supervisor: boolean;
  limit: number;
  ttlSeconds?: number;
  statuses?: string[];
  campaignId?: string | null;
  packId?: string | null;
  /** Restrict to specific leads (session builder / callback claims). */
  leadIds?: string[] | null;
  /**
   * Pick candidates in `leadIds` LIST ORDER instead of never-dialed-first —
   * the queue-fidelity contract: the dialer sends its display queue from the
   * rep's position, and the round must follow it. Only meaningful with
   * leadIds; eligibility (DNC, scope, holds, cooldown) still applies.
   */
  preserveOrder?: boolean;
  cooldownMinutes?: number;
  maxAttempts?: number;
  /**
   * When set, each claimed lead is re-checked against the calling window in
   * ITS OWN timezone (area-code inference — TS-only, which is why this check
   * can't live in the SQL). Out-of-window leads are released immediately and
   * dropped from the result.
   */
  window?: AutomationSettings | null;
  now?: Date;
}

/** Atomically claim up to `limit` eligible leads, never-dialed first. */
export async function claimDialLeads(opts: ClaimOptions): Promise<Lead[]> {
  if (!isAdminConfigured() || !opts.orgId || opts.limit <= 0) return [];
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("app_claim_dial_leads", {
      p_org: opts.orgId,
      p_user: opts.userId,
      p_supervisor: opts.supervisor,
      p_limit: Math.min(Math.max(1, opts.limit), 500),
      p_ttl_seconds: opts.ttlSeconds ?? RESERVATION_TTL_SEC,
      p_statuses: sanitizeSegments(opts.statuses ?? []),
      p_campaign: opts.campaignId ?? null,
      p_pack: opts.packId ?? null,
      p_cooldown_minutes: Math.max(0, Math.round(opts.cooldownMinutes ?? 0)),
      p_max_attempts: Math.max(0, Math.round(opts.maxAttempts ?? 0)),
      p_lead_ids: opts.leadIds?.length ? opts.leadIds : null,
      p_preserve_order: Boolean(opts.preserveOrder && opts.leadIds?.length),
    });
    if (error) {
      count("reservation.claim_fail", 1, { orgId: opts.orgId });
      return [];
    }
    const claimed = ((data ?? []) as Record<string, unknown>[]).map(rowToLead);

    // Reservation claims are auditable lifecycle events.
    for (const l of claimed) {
      void applyCallEvent({
        source: "app",
        type: "reservation.claimed",
        attemptRef: { orgId: opts.orgId },
        payload: { leadId: l.id, by: opts.userId },
      });
    }

    if (!opts.window) return claimed;

    // Per-lead-timezone calling window (TCPA follows the CALLED party's clock).
    const now = opts.now ?? new Date();
    const inWindow: Lead[] = [];
    const outIds: string[] = [];
    for (const lead of claimed) {
      const tz = resolveLeadTimezone(lead.phone, lead.timezone, opts.window.timezone);
      if (isWithinCallingWindow(now, opts.window, tz)) inWindow.push(lead);
      else outIds.push(lead.id);
    }
    if (outIds.length) await releaseDialLeads(opts.orgId, opts.userId, outIds);
    return inWindow;
  } catch {
    count("reservation.claim_fail", 1, { orgId: opts.orgId });
    return [];
  }
}

/** Release holds this user placed (skip, session end, out-of-window). */
export async function releaseDialLeads(
  orgId: string,
  userId: string,
  leadIds: string[],
): Promise<number> {
  if (!isAdminConfigured() || !orgId || !leadIds.length) return 0;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("app_release_dial_leads", {
      p_org: orgId,
      p_user: userId,
      p_lead_ids: leadIds,
    });
    if (error) return 0;
    return Number(data ?? 0);
  } catch {
    return 0;
  }
}

/** Renew unexpired holds while the lead is on the rep's screen. */
export async function renewReservations(
  orgId: string,
  userId: string,
  leadIds: string[],
  ttlSeconds = RESERVATION_TTL_SEC,
): Promise<number> {
  if (!isAdminConfigured() || !orgId || !leadIds.length) return 0;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("app_renew_dial_reservations", {
      p_org: orgId,
      p_user: userId,
      p_lead_ids: leadIds,
      p_ttl_seconds: ttlSeconds,
    });
    if (error) return 0;
    return Number(data ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Stamp the attempt at provider initiation: counter + last_attempt_at +
 * next-eligible gate, and the hold is released in the same statement.
 * `cooldownMinutes` 0 leaves next_eligible_at null (no gate).
 */
export async function markLeadAttempted(
  orgId: string,
  leadId: string,
  opts?: { cooldownMinutes?: number; at?: Date },
): Promise<void> {
  if (!isAdminConfigured() || !orgId || !leadId) return;
  try {
    const at = opts?.at ?? new Date();
    const cooldownMin = Math.max(0, Math.round(opts?.cooldownMinutes ?? 0));
    const admin = createAdminClient();
    await admin.rpc("app_mark_lead_attempted", {
      p_org: orgId,
      p_lead: leadId,
      p_at: at.toISOString(),
      p_next_eligible: cooldownMin
        ? new Date(at.getTime() + cooldownMin * 60_000).toISOString()
        : null,
    });
  } catch {
    /* best-effort — the reconcile-data cron repairs counter drift */
  }
}
