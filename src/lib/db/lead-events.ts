import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// Per-lead audit events — the Lead 360 timeline's backbone.
//
// Every write here is FIRE-AND-FORGET on purpose: an audit line must never slow
// down or fail the operation it describes (a disposition save, a pack deal, a
// DNC add). The inserts run detached, swallow every error, and no-op entirely
// when the service role is absent — the product keeps working, the timeline
// just has fewer entries.
//
// Rows land in `lead_events` (schema.sql: lead_id / kind / payload / actor_id).
// Kinds are a closed set shared with the timeline renderer; payload is a small
// JSON bag the timeline knows how to describe per kind.
// ─────────────────────────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LeadEventKind = "status" | "assignment" | "dnc" | "field_change" | "note";

export interface LeadEventInput {
  leadId: string;
  /** Omit/null to have it resolved from the lead row (one extra async read —
   *  acceptable because the whole write is detached). */
  orgId?: string | null;
  actorId?: string | null;
  kind: LeadEventKind;
  payload?: Record<string, unknown>;
}

/** One event row, ready to insert. */
function toRow(input: LeadEventInput, orgId: string | null) {
  return {
    org_id: orgId,
    lead_id: input.leadId,
    actor_id: input.actorId && UUID.test(input.actorId) ? input.actorId : null,
    kind: input.kind,
    payload: input.payload ?? {},
  };
}

/**
 * Log one audit event for a lead. Fire-and-forget: returns immediately, never
 * throws, no-ops without a service role.
 */
export function logLeadEvent(input: LeadEventInput): void {
  if (!isAdminConfigured() || !UUID.test(input.leadId)) return;
  void (async () => {
    try {
      const admin = createAdminClient();
      let orgId = input.orgId && UUID.test(input.orgId) ? input.orgId : null;
      if (!orgId) {
        const { data } = await admin
          .from("leads")
          .select("org_id")
          .eq("id", input.leadId)
          .maybeSingle();
        orgId = data?.org_id ? String(data.org_id) : null;
      }
      await admin.from("lead_events").insert(toRow(input, orgId));
    } catch {
      /* audit is best-effort by contract */
    }
  })();
}

/**
 * Log the SAME event against many leads in one batched insert — used by pack
 * assignment, where every lead in the pack should show "dealt to Marcus" on its
 * own timeline. Fire-and-forget like logLeadEvent.
 */
export function logLeadEventBulk(input: {
  leadIds: string[];
  orgId?: string | null;
  actorId?: string | null;
  kind: LeadEventKind;
  payload?: Record<string, unknown>;
}): void {
  if (!isAdminConfigured()) return;
  const ids = [...new Set(input.leadIds.filter((id) => UUID.test(id)))].slice(0, 2000);
  if (!ids.length) return;
  void (async () => {
    try {
      const admin = createAdminClient();
      const orgId = input.orgId && UUID.test(input.orgId) ? input.orgId : null;
      const rows = ids.map((leadId) =>
        toRow({ ...input, leadId }, orgId),
      );
      // Chunked so one giant pack can't blow a single request's body limits.
      const CHUNK = 500;
      for (let i = 0; i < rows.length; i += CHUNK) {
        await admin.from("lead_events").insert(rows.slice(i, i + CHUNK));
      }
    } catch {
      /* best-effort */
    }
  })();
}

/**
 * Log a DNC add/remove against every lead in the org whose number matches the
 * suppressed digits. The suppression list is keyed by phone, not lead — so the
 * lead ids are DERIVED here (last-10 match, the list's own key shape). When no
 * lead carries the number the event is skipped entirely: there is no lead
 * timeline to write to, and lead_events.lead_id is NOT NULL by design.
 */
export function logDncEventForPhone(input: {
  orgId: string;
  phone: string;
  action: "added" | "removed";
  reason?: string | null;
  source?: string | null;
  actorId?: string | null;
}): void {
  if (!isAdminConfigured() || !UUID.test(input.orgId)) return;
  const digits = (input.phone || "").replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return;
  void (async () => {
    try {
      const admin = createAdminClient();
      const { data } = await admin
        .from("leads")
        .select("id, phone")
        .eq("org_id", input.orgId)
        .ilike("phone", `%${digits}%`)
        .limit(20);
      const leadIds = ((data ?? []) as { id: unknown; phone: unknown }[])
        .filter((r) => String(r.phone ?? "").replace(/\D/g, "").slice(-10) === digits)
        .map((r) => String(r.id));
      if (!leadIds.length) return; // no lead carries this number — skip
      const rows = leadIds.map((leadId) =>
        toRow(
          {
            leadId,
            actorId: input.actorId ?? null,
            kind: "dnc",
            payload: {
              action: input.action,
              digits,
              reason: input.reason ?? null,
              source: input.source ?? null,
            },
          },
          input.orgId,
        ),
      );
      await admin.from("lead_events").insert(rows);
    } catch {
      /* best-effort */
    }
  })();
}
