import "server-only";

import {
  appointments as demoAppointments,
  callbacks as demoCallbacks,
  callRecords as demoCallRecords,
  campaigns as demoCampaigns,
  getLeadById as demoLeadById,
} from "../data";
import { evaluateEligibility, type IneligibleReason } from "../dialer/eligibility";
import { inferNumberLocation, type NumberLocation } from "../leads/area-code";
import { DIALABLE_STATUSES } from "../leads/dialable";
import {
  formatFieldValue,
  leadFieldValue,
  resolveLeadFields,
  type LeadFieldDef,
} from "../leads/field-schema";
import { getViewer } from "../org/membership";
import { templateProfile } from "../org/templates";
import { isSolarVertical } from "../org/vertical";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { Lead, LeadStatus } from "../types";
import { dncKey } from "./dnc";
import { rowToLead } from "./leads";
import { canActOn, getScope, type Scope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// Lead 360 — ONE assembled record view for a single lead.
//
// The app had nine partial lead renderings; this module is the canonical "tell
// me everything about this lead" read that the drawer and the /leads/[id] page
// both consume. Authorization is identical to every other lead read: supervisor
// → their whole org, rep → leads they uploaded or were assigned. Out-of-scope
// reads return nothing — a lead in ANOTHER org reads as not-found, never as
// "denied", so the response can't confirm a foreign id exists.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const str = (v: unknown): string | null => (v == null ? null : String(v));

/**
 * Twilio media is private and 401s in a browser; our authenticated proxy
 * serves it. Mirrors toPlayableRecording in db/call-archive.ts (kept private
 * there) — the regex is the whole contract.
 */
function playableRecordingUrl(raw: string | null): string | null {
  if (!raw) return null;
  const m = /\/Recordings\/(RE[0-9a-f]{32})/i.exec(raw);
  return m ? `/api/twilio/recording/${m[1]}` : raw;
}

// ── Access ───────────────────────────────────────────────────────────────────

export type ScopedLeadAccess =
  | { ok: true; row: Row; scope: Scope }
  | { ok: false; reason: "unauthenticated" | "denied" | "not_found" };

/**
 * Resolve the lead row IF the current viewer may see it. Shared by the panel
 * and the timeline so the two can never disagree about scope.
 *
 * "denied" is returned ONLY for a lead inside the viewer's own org that isn't
 * in their book (rep, not owner/assignee) — the honest "ask your manager"
 * state. Anything cross-org or unknown is "not_found".
 */
export async function getScopedLeadRow(leadId: string): Promise<ScopedLeadAccess> {
  if (!UUID.test(leadId)) return { ok: false, reason: "not_found" };
  const scope = await getScope();
  if (!scope) return { ok: false, reason: "unauthenticated" };
  try {
    const reader = isAdminConfigured() ? createAdminClient() : await createClient();
    const { data } = await reader.from("leads").select("*").eq("id", leadId).maybeSingle();
    if (!data) return { ok: false, reason: "not_found" };
    const row = data as Row;
    const rowOwnerId = str(row.owner_id);
    const rowOrgId = str(row.org_id);
    const assigned = str(row.assigned_rep_id);
    const inScope =
      canActOn(scope, rowOwnerId, rowOrgId) ||
      (assigned === scope.userId && (!rowOrgId || rowOrgId === scope.orgId));
    if (inScope) return { ok: true, row, scope };
    // Same org but not their book → denied; anything else reads as absent.
    if (rowOrgId && rowOrgId === scope.orgId) return { ok: false, reason: "denied" };
    return { ok: false, reason: "not_found" };
  } catch {
    return { ok: false, reason: "not_found" };
  }
}

// ── Shapes ───────────────────────────────────────────────────────────────────

export interface LeadPanelField {
  def: LeadFieldDef;
  value: string | number | boolean | null;
  /** Display string via formatFieldValue — "—" when empty. */
  formatted: string;
}

export interface LeadPanel {
  lead: Lead;
  /** Phase-1 lifecycle columns the Lead shape doesn't carry. */
  meta: {
    importJobId: string | null;
    sourceFile: string | null;
    originalRow: number | null;
    dialingPreference: "ai" | "manual" | "either" | "none";
    archivedAt: string | null;
    attemptCount: number;
    lastAttemptAt: string | null;
    nextEligibleAt: string | null;
    createdAt: string;
  };
  /** The org's resolved schema with this lead's values — core first, then custom. */
  fields: LeadPanelField[];
  /** Uploader (owner_id) display name. */
  ownerName: string | null;
  /** Assigned rep (assigned_rep_id) display name. */
  assignedRepName: string | null;
  packLabel: string | null;
  campaignName: string | null;
  groupLabel: string | null;
  /** Null when the number is clean AND has no history worth a section. */
  dnc: {
    suppressed: boolean;
    reason: string;
    source: string;
    addedAt: string | null;
    addedByName: string | null;
  } | null;
  eligibility: { eligible: boolean; reasons: IneligibleReason[] };
  /** Inference from the AREA CODE — never the person's location; label it so. */
  numberLocation: NumberLocation | null;
  nextAppointment: {
    id: string;
    scheduledAt: string | null;
    label: string;
    status: string;
  } | null;
  nextCallback: { id: string; dueAt: string | null; reason: string; status: string } | null;
  recordings: {
    id: string;
    startedAt: string;
    outcome: string | null;
    durationSec: number;
    url: string;
  }[];
  aiSummary: {
    summary: string;
    sentiment: string | null;
    at: string;
    source: "claude" | "demo";
  } | null;
}

export type LeadPanelResult =
  | { ok: true; panel: LeadPanel }
  | { ok: false; reason: "unauthenticated" | "denied" | "not_found" };

// ── Field schema resolution (mirrors the (app) layout) ───────────────────────

/**
 * The org's effective lead-field schema, resolved EXACTLY like the (app)
 * layout resolves `leadFields` — org settings win, then the vertical
 * template's relabels/hides, plus the legacy solar double-gate. Duplicating
 * the precedence here (rather than importing the layout) keeps this module
 * callable from API routes; the rules are the layout's, comment-for-comment.
 */
function resolveOrgLeadFields(
  org: {
    dialerTemplate?: string;
    settings?: {
      leadFields?: LeadFieldDef[];
      qualify?: { showSolarPayment?: boolean; otherToggleLabel?: string };
    };
  } | null,
): LeadFieldDef[] {
  const settings = org?.settings;
  const profile = templateProfile(org?.dialerTemplate);
  const savedCoreKeys = new Set(
    (settings?.leadFields ?? []).filter((f) => f.source === "core").map((f) => f.key),
  );
  let fields = resolveLeadFields(settings?.leadFields, profile.fields);
  const solarAllowed =
    isSolarVertical(org?.dialerTemplate) && (settings?.qualify?.showSolarPayment ?? true);
  if (!solarAllowed) {
    fields = fields.filter(
      (f) => savedCoreKeys.has(f.key) || (f.key !== "solarPayment" && f.key !== "solarProvider"),
    );
  }
  const templateHidden = new Set(profile.fields?.hidden ?? []);
  fields = fields.filter((f) => savedCoreKeys.has(f.key) || !templateHidden.has(f.key));
  const legacyOtherLabel = settings?.qualify?.otherToggleLabel?.trim();
  if (
    legacyOtherLabel &&
    legacyOtherLabel !== "Battery" &&
    legacyOtherLabel !== "Other" &&
    !savedCoreKeys.has("hasBattery")
  ) {
    fields = fields.map((f) =>
      f.key === "hasBattery" ? { ...f, label: legacyOtherLabel } : f,
    );
  }
  return fields;
}

function fieldValues(lead: Lead, defs: LeadFieldDef[]): LeadPanelField[] {
  return defs.map((def) => {
    const raw = leadFieldValue(lead, def);
    const value = raw === undefined ? null : raw;
    return { def, value, formatted: formatFieldValue(value, def.type) };
  });
}

/** The one dial-worthiness snapshot the panel shows — basic policy: dialable
 *  statuses, no cooldown/attempt caps, no window (those are session-specific). */
function eligibilitySnapshot(
  row: {
    id: string;
    orgId: string | null;
    ownerId: string | null;
    assignedRepId: string | null;
    status: LeadStatus;
    phone: string;
    timezone: string | null;
    attemptCount: number;
    lastAttemptAt: string | null;
    nextEligibleAt: string | null;
    reservedBy: string | null;
    reservedUntil: string | null;
    campaignId: string | null;
    leadPackId: string | null;
  },
  scope: { userId: string; orgId: string | null; supervisor: boolean },
  suppressedDigits: Set<string>,
): { eligible: boolean; reasons: IneligibleReason[] } {
  const result = evaluateEligibility(
    {
      id: row.id,
      orgId: row.orgId,
      ownerId: row.ownerId,
      assignedRepId: row.assignedRepId,
      status: row.status,
      phoneDigits: row.phone,
      timezone: row.timezone,
      attemptCount: row.attemptCount,
      lastAttemptAt: row.lastAttemptAt,
      nextEligibleAt: row.nextEligibleAt,
      reservedBy: row.reservedBy,
      reservedUntil: row.reservedUntil,
      campaignId: row.campaignId,
      leadPackId: row.leadPackId,
    },
    {
      now: new Date(),
      actor: { userId: scope.userId, orgId: scope.orgId ?? "", supervisor: scope.supervisor },
      mode: "manual",
      policy: {
        statuses: [...DIALABLE_STATUSES],
        cooldownMinutes: 0,
        maxAttempts: 0,
        window: null,
      },
      isDnc: (last10) => suppressedDigits.has(last10),
    },
  );
  return { eligible: result.eligible, reasons: result.reasons };
}

// ── Demo synthesis ───────────────────────────────────────────────────────────

async function demoPanel(leadId: string): Promise<LeadPanelResult> {
  const lead = demoLeadById(leadId);
  if (!lead) return { ok: false, reason: "not_found" };
  const viewer = await getViewer();
  const defs = resolveOrgLeadFields(viewer.org);
  const scope = { userId: "demo", orgId: null, supervisor: true };
  const campaign = demoCampaigns.find((c) => c.id === lead.campaignId) ?? null;
  const appt = demoAppointments
    .filter((a) => a.leadId === lead.id && a.status === "scheduled")
    .sort((a, b) => (a.scheduledAt < b.scheduledAt ? -1 : 1))[0];
  const cb = demoCallbacks
    .filter((c) => c.leadId === lead.id && c.status !== "completed")
    .sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1))[0];
  const calls = demoCallRecords
    .filter((c) => c.leadId === lead.id)
    .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  const latest = calls.find((c) => c.hasSummary);
  return {
    ok: true,
    panel: {
      lead,
      meta: {
        importJobId: null,
        sourceFile: null,
        originalRow: null,
        dialingPreference: "either",
        archivedAt: null,
        attemptCount: calls.length,
        lastAttemptAt: calls[0]?.startedAt ?? null,
        nextEligibleAt: null,
        createdAt: lead.createdAt,
      },
      fields: fieldValues(lead, defs),
      ownerName: viewer.displayName,
      assignedRepName: null,
      packLabel: null,
      campaignName: campaign?.name ?? null,
      groupLabel: lead.leadGroup
        ? lead.leadGroup.charAt(0).toUpperCase() + lead.leadGroup.slice(1)
        : null,
      dnc: lead.status === "dnc"
        ? {
            suppressed: true,
            reason: "Asked not to be called",
            source: "rep_disposition",
            addedAt: lead.lastContactedAt ?? null,
            addedByName: viewer.displayName,
          }
        : null,
      eligibility: eligibilitySnapshot(
        {
          id: lead.id,
          orgId: null,
          ownerId: "demo",
          assignedRepId: null,
          status: lead.status,
          phone: lead.phone,
          timezone: lead.timezone,
          attemptCount: calls.length,
          lastAttemptAt: null,
          nextEligibleAt: null,
          reservedBy: null,
          reservedUntil: null,
          campaignId: lead.campaignId || null,
          leadPackId: lead.leadPackId ?? null,
        },
        scope,
        lead.status === "dnc" ? new Set([dncKey(lead.phone)]) : new Set<string>(),
      ),
      numberLocation: inferNumberLocation(lead.phone),
      nextAppointment: appt
        ? { id: appt.id, scheduledAt: appt.scheduledAt, label: "", status: appt.status }
        : null,
      nextCallback: cb
        ? { id: cb.id, dueAt: cb.dueAt, reason: cb.reason, status: cb.status }
        : null,
      // Sample recordings carry a placeholder "#" URL — nothing playable, so
      // the demo shows the honest empty state instead of a dead player.
      recordings: [],
      aiSummary: latest
        ? {
            summary:
              "Positive conversation — interested in reviewing options and asked for concrete numbers before the next call.",
            sentiment: "positive",
            at: latest.startedAt,
            source: "demo",
          }
        : null,
    },
  };
}

// ── Live assembly ────────────────────────────────────────────────────────────

export async function getLeadPanelResult(leadId: string): Promise<LeadPanelResult> {
  if (!isSupabaseConfigured()) return demoPanel(leadId);

  const access = await getScopedLeadRow(leadId);
  if (!access.ok) return access;
  const { row, scope } = access;

  try {
    const db = isAdminConfigured() ? createAdminClient() : await createClient();
    const lead = rowToLead(row);
    const orgId = str(row.org_id);
    const ownerId = str(row.owner_id);
    const assignedRepId = str(row.assigned_rep_id);
    const packId = str(row.lead_pack_id);
    const campaignId = str(row.campaign_id);
    const groupKey = str(row.lead_group);
    const digits = dncKey(lead.phone);

    const memberIds = [...new Set([ownerId, assignedRepId].filter(Boolean))] as string[];

    const [members, pack, campaign, group, dncRow, appt, cb, recs, summaryRec] =
      await Promise.all([
        memberIds.length && orgId
          ? db
              .from("organization_members")
              .select("user_id,name")
              .eq("org_id", orgId)
              .in("user_id", memberIds)
          : Promise.resolve({ data: [] as Row[] }),
        packId
          ? db.from("lead_packs").select("id,label").eq("id", packId).maybeSingle()
          : Promise.resolve({ data: null }),
        campaignId
          ? db.from("campaigns").select("id,name").eq("id", campaignId).maybeSingle()
          : Promise.resolve({ data: null }),
        groupKey && orgId
          ? db
              .from("lead_groups")
              .select("key,label")
              .eq("org_id", orgId)
              .eq("key", groupKey)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        digits && orgId
          ? db
              .from("dnc_numbers")
              .select("reason,source,created_at,created_by")
              .eq("org_id", orgId)
              .eq("phone_digits", digits)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        db
          .from("appointments")
          .select("id,scheduled_at,scheduled_label,status")
          .eq("lead_id", leadId)
          .eq("status", "scheduled")
          .order("scheduled_at", { ascending: true, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("callbacks")
          .select("id,due_at,reason,status")
          .eq("lead_id", leadId)
          .neq("status", "completed")
          .order("due_at", { ascending: true, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        db
          .from("call_records")
          .select("id,started_at,outcome,duration_sec,recording_url")
          .eq("lead_id", leadId)
          .not("recording_url", "is", null)
          .order("started_at", { ascending: false })
          .limit(20),
        db
          .from("call_records")
          .select("id,summary,sentiment,started_at")
          .eq("lead_id", leadId)
          .not("summary", "is", null)
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    // Result unwrappers — the Promise.all above mixes maybeSingle() results and
    // resolved placeholders, so both are read through one narrow shape.
    const one = (res: unknown): Row | null =>
      ((res as { data?: Row | null } | null)?.data as Row | null) ?? null;
    const many = (res: unknown): Row[] =>
      (((res as { data?: Row[] } | null)?.data ?? []) as Row[]);

    const nameById = new Map(
      many(members).map((m) => [String(m.user_id), String(m.name ?? "")]),
    );

    const dncData = one(dncRow);
    const dncByName = dncData?.created_by ? nameById.get(String(dncData.created_by)) : null;

    const viewer = await getViewer();
    const defs = resolveOrgLeadFields(viewer.org);

    const packData = one(pack);
    const campaignData = one(campaign);
    const groupData = one(group);
    const apptData = one(appt);
    const cbData = one(cb);
    const sumData = one(summaryRec);

    const panel: LeadPanel = {
      lead,
      meta: {
        importJobId: str(row.import_job_id),
        sourceFile: str(row.source_file),
        originalRow: row.original_row == null ? null : Number(row.original_row),
        dialingPreference: (str(row.dialing_preference) ??
          "either") as LeadPanel["meta"]["dialingPreference"],
        archivedAt: str(row.archived_at),
        attemptCount: Number(row.attempt_count ?? 0),
        lastAttemptAt: str(row.last_attempt_at),
        nextEligibleAt: str(row.next_eligible_at),
        createdAt: lead.createdAt,
      },
      fields: fieldValues(lead, defs),
      ownerName: ownerId ? nameById.get(ownerId) || null : null,
      assignedRepName: assignedRepId ? nameById.get(assignedRepId) || null : null,
      packLabel: packData ? str(packData.label) : null,
      campaignName: campaignData ? str(campaignData.name) : null,
      groupLabel: (groupData ? str(groupData.label) : null) ?? groupKey,
      dnc: dncData
        ? {
            suppressed: true,
            reason: String(dncData.reason ?? ""),
            source: String(dncData.source ?? ""),
            addedAt: str(dncData.created_at),
            addedByName: dncByName || null,
          }
        : null,
      eligibility: eligibilitySnapshot(
        {
          id: lead.id,
          orgId,
          ownerId,
          assignedRepId,
          status: lead.status,
          phone: lead.phone,
          timezone: str(row.timezone),
          attemptCount: Number(row.attempt_count ?? 0),
          lastAttemptAt: str(row.last_attempt_at),
          nextEligibleAt: str(row.next_eligible_at),
          reservedBy: str(row.reserved_by),
          reservedUntil: str(row.reserved_until),
          campaignId,
          leadPackId: packId,
        },
        scope,
        dncData && digits ? new Set([digits]) : new Set<string>(),
      ),
      numberLocation: inferNumberLocation(lead.phone),
      nextAppointment: apptData
        ? {
            id: String(apptData.id),
            scheduledAt: str(apptData.scheduled_at),
            label: String(apptData.scheduled_label ?? ""),
            status: String(apptData.status ?? "scheduled"),
          }
        : null,
      nextCallback: cbData
        ? {
            id: String(cbData.id),
            dueAt: str(cbData.due_at),
            reason: String(cbData.reason ?? ""),
            status: String(cbData.status ?? "due"),
          }
        : null,
      recordings: many(recs)
        .map((r) => ({
          id: String(r.id),
          startedAt: String(r.started_at ?? ""),
          outcome: str(r.outcome),
          durationSec: Number(r.duration_sec ?? 0),
          url: playableRecordingUrl(str(r.recording_url)) ?? "",
        }))
        .filter((r) => Boolean(r.url)),
      aiSummary: sumData
        ? {
            summary: String(sumData.summary ?? ""),
            sentiment: str(sumData.sentiment),
            at: String(sumData.started_at ?? ""),
            source: "claude",
          }
        : null,
    };
    return { ok: true, panel };
  } catch {
    return { ok: false, reason: "not_found" };
  }
}

/** The spec'd simple read: the panel, or null when missing / out of scope. */
export async function getLeadPanel(leadId: string): Promise<LeadPanel | null> {
  const result = await getLeadPanelResult(leadId);
  return result.ok ? result.panel : null;
}
