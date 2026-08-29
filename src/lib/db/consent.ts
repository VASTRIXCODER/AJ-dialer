import "server-only";

import {
  UNKNOWN_CONSENT,
  type ConsentChannel,
  type ConsentScope,
  type ConsentSnapshot,
  type ConsentSource,
} from "../consent/state";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { count } from "../telemetry";
import { dncKey } from "./dnc";

// ─────────────────────────────────────────────────────────────────────────────
// Reading and writing the consent ledger (PART 40).
//
// Writes go through the `app_record_consent` RPC rather than touching either
// table, because the ledger row and the projected state must land together or
// not at all — a state row with no event behind it is permission we cannot
// evidence, and an event with no state is permission the gate will never see.
// The RPC also holds the out-of-order guard: a late webhook retry carrying an
// older timestamp can never demote a newer decision.
//
// Reads fail CLOSED. Every catch here returns "unknown", which the pure module
// treats exactly like "revoked" — so a database hiccup during a send blocks the
// send rather than waving it through.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export interface RecordConsentInput {
  orgId: string;
  phone: string;
  channel: ConsentChannel;
  action: "granted" | "revoked";
  scope: ConsentScope;
  source: ConsentSource;
  /** The words, as shown or said. Stored verbatim — this IS the evidence. */
  evidence?: string;
  /** Where the original lives: a call record id, a message id, a form id. */
  evidenceRef?: string | null;
  leadId?: string | null;
  actorId?: string | null;
  /** When they actually said it, if that differs from now. */
  capturedAt?: Date | null;
}

/** Record consent (or its withdrawal). False when nothing was written. */
export async function recordConsent(input: RecordConsentInput): Promise<boolean> {
  const digits = dncKey(input.phone);
  if (!input.orgId || !digits || !isAdminConfigured()) return false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.rpc("app_record_consent", {
      p_org: input.orgId,
      p_digits: digits,
      p_channel: input.channel,
      p_action: input.action,
      p_scope: input.scope,
      p_source: input.source,
      p_evidence: (input.evidence ?? "").slice(0, 2000),
      p_evidence_ref: input.evidenceRef ?? null,
      p_lead: input.leadId ?? null,
      p_actor: input.actorId ?? null,
      p_captured_at: (input.capturedAt ?? new Date()).toISOString(),
    });
    if (error) {
      count("consent.record_fail", 1, { orgId: input.orgId });
      return false;
    }
    return true;
  } catch {
    count("consent.record_fail", 1, { orgId: input.orgId });
    return false;
  }
}

/**
 * The current state for one number on one channel.
 *
 * Returns UNKNOWN_CONSENT for a genuinely absent row AND for any failure —
 * they are the same answer to the only question the caller is asking ("may we
 * send?"), and both must resolve to no.
 */
export async function getConsent(
  orgId: string | null,
  phone: string,
  channel: ConsentChannel = "sms",
): Promise<ConsentSnapshot> {
  const digits = dncKey(phone);
  if (!orgId || !digits || !isAdminConfigured()) return UNKNOWN_CONSENT;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("consent_state")
      .select("status, scope, source, captured_at")
      .eq("org_id", orgId)
      .eq("phone_digits", digits)
      .eq("channel", channel)
      .maybeSingle();
    if (!data) return UNKNOWN_CONSENT;
    const row = data as Row;
    return {
      status: s(row.status) === "granted" ? "granted" : "revoked",
      scope: s(row.scope) === "promotional" ? "promotional" : "transactional",
      source: s(row.source),
      capturedAt: s(row.captured_at) || null,
    };
  } catch {
    return UNKNOWN_CONSENT;
  }
}

/**
 * State for many numbers at once, keyed by last-10 digits. The send drain
 * gates a batch, and one point-read per message would make the batch's cost
 * linear in a way that shows up as a slow cron rather than as an error.
 *
 * A number missing from the returned map is unknown — callers must NOT read an
 * absent key as permitted.
 */
export async function getConsentMany(
  orgId: string | null,
  phones: string[],
  channel: ConsentChannel = "sms",
): Promise<Map<string, ConsentSnapshot>> {
  const out = new Map<string, ConsentSnapshot>();
  const digits = [...new Set(phones.map(dncKey).filter(Boolean))];
  if (!orgId || !digits.length || !isAdminConfigured()) return out;
  try {
    const admin = createAdminClient();
    // Chunked: PostgREST builds `in.(…)` into the URL, and a few thousand
    // numbers would exceed the request line.
    for (let i = 0; i < digits.length; i += 500) {
      const { data } = await admin
        .from("consent_state")
        .select("phone_digits, status, scope, source, captured_at")
        .eq("org_id", orgId)
        .eq("channel", channel)
        .in("phone_digits", digits.slice(i, i + 500));
      for (const row of ((data ?? []) as Row[])) {
        out.set(s(row.phone_digits), {
          status: s(row.status) === "granted" ? "granted" : "revoked",
          scope: s(row.scope) === "promotional" ? "promotional" : "transactional",
          source: s(row.source),
          capturedAt: s(row.captured_at) || null,
        });
      }
    }
    return out;
  } catch {
    // Fail closed: an empty map means every number reads as unknown.
    return new Map();
  }
}

export interface ConsentLedgerEntry {
  id: string;
  action: "granted" | "revoked";
  scope: ConsentScope;
  source: string;
  evidence: string;
  evidenceRef: string | null;
  actorName: string | null;
  capturedAt: string;
}

/** The full history for one number — what a compliance question asks for. */
export async function getConsentHistory(
  orgId: string | null,
  phone: string,
  channel: ConsentChannel = "sms",
  limit = 25,
): Promise<ConsentLedgerEntry[]> {
  const digits = dncKey(phone);
  if (!orgId || !digits || !isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("consent_events")
      .select("id, action, scope, source, evidence, evidence_ref, actor_id, captured_at")
      .eq("org_id", orgId)
      .eq("phone_digits", digits)
      .eq("channel", channel)
      .order("captured_at", { ascending: false })
      .limit(limit);
    const rows = (data ?? []) as Row[];
    const actorIds = [...new Set(rows.map((r) => s(r.actor_id)).filter(Boolean))];
    const names = new Map<string, string>();
    if (actorIds.length) {
      const { data: members } = await admin
        .from("organization_members")
        .select("user_id, name")
        .eq("org_id", orgId)
        .in("user_id", actorIds);
      for (const m of ((members ?? []) as Row[])) names.set(s(m.user_id), s(m.name));
    }
    return rows.map((r) => ({
      id: s(r.id),
      action: s(r.action) === "granted" ? "granted" : "revoked",
      scope: s(r.scope) === "promotional" ? "promotional" : "transactional",
      source: s(r.source),
      evidence: s(r.evidence),
      evidenceRef: r.evidence_ref ? s(r.evidence_ref) : null,
      actorName: names.get(s(r.actor_id)) || null,
      capturedAt: s(r.captured_at),
    }));
  } catch {
    return [];
  }
}
