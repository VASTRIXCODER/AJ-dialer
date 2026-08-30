import "server-only";

import { findByCallSid, getAICall } from "../ai-call-store";
import { leads as demoLeads } from "../data";
import { getConversationLeadRef } from "../db/records";
import {
  type AgentKey,
  agentVariablesForLead,
  currentDateVariables,
} from "../elevenlabs";
import { mergeSettings } from "../org/settings";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import type { Lead } from "../types";
import {
  type AgentConfig,
  type AgentOrgLike,
  resolveAgentConfig,
} from "./agent-prompt";

// ─────────────────────────────────────────────────────────────────────────────
// Resolve the live agent configuration + personalization variables for an
// outbound call, so the personalization webhook configures the agent from the
// correct organization and lead (Sunrun/solar → the Emily script).
//
// SECURITY: every AI call in this product is placed BY US — there is no inbound
// flow — so the exact lead is already known the instant placeAiCallForLead
// registers the call, keyed by conversationId/callSid. That registration is the
// PRIMARY and only trustworthy identity signal here. The old version of this
// file matched purely by phone number across EVERY organization's leads at
// once: if the same homeowner's number exists as a lead row in more than one
// org (two tenants working overlapping/purchased lead lists), it could resolve
// a different org's name, script, and PII into this call. Phone matching is
// kept only as a last-resort fallback for a call we somehow have no
// registration for, and even then it refuses to guess across a genuine
// multi-org collision — see resolveByPhoneScoped().
// ─────────────────────────────────────────────────────────────────────────────

const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
type Row = Record<string, unknown>;
type AdminClient = ReturnType<typeof createAdminClient>;

function rowToLead(r: Row): Lead {
  const num = (v: unknown) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : undefined;
  };
  return {
    id: String(r.id ?? ""),
    firstName: String(r.first_name ?? ""),
    lastName: String(r.last_name ?? ""),
    phone: String(r.phone ?? ""),
    email: (r.email as string) ?? undefined,
    address: String(r.address ?? ""),
    city: String(r.city ?? ""),
    state: String(r.state ?? ""),
    zip: String(r.zip ?? ""),
    utilityProvider: String(r.utility_provider ?? ""),
    solarProvider: String(r.solar_provider ?? ""),
    status: "new",
    campaignId: String(r.campaign_id ?? ""),
    solarPayment: num(r.solar_payment),
    utilityBill: num(r.utility_bill),
    hasEV: Boolean(r.has_ev),
    hasPool: Boolean(r.has_pool),
    hasBattery: Boolean(r.has_battery),
    multipleSystems: Boolean(r.multiple_systems),
    createdAt: String(r.created_at ?? new Date().toISOString()),
    timezone: String(r.timezone ?? ""),
    // Typed CSV spillover — without this, custom fields would silently never
    // reach the voice agent's {{custom_*}} dynamic variables.
    customFields:
      r.custom_fields && typeof r.custom_fields === "object"
        ? (r.custom_fields as Record<string, string | number | boolean>)
        : undefined,
  };
}

function rowToOrgLike(o: Row): AgentOrgLike {
  return {
    name: String(o.name ?? ""),
    productName: String(o.product_name ?? ""),
    dialerTemplate: String(o.dialer_template ?? "general"),
    settings: mergeSettings(o.settings),
  };
}

async function loadOrgLike(admin: AdminClient, orgId: unknown): Promise<AgentOrgLike | null> {
  if (!orgId) return null;
  const { data: org } = await admin
    .from("organizations")
    .select("*")
    .eq("id", orgId)
    .maybeSingle();
  return org ? rowToOrgLike(org as Row) : null;
}

/**
 * The organization an AI conversation belongs to (service-role; webhook path —
 * no session). Lets the post-call pipeline analyze a transcript with the RIGHT
 * org's AI context instead of assuming every tenant is solar. Null in demo mode
 * or when the conversation was never stamped with an org — callers treat that
 * as the historical solar default.
 */
export async function orgLikeForConversation(
  conversationId: string,
): Promise<AgentOrgLike | null> {
  if (!isSupabaseConfigured() || !isAdminConfigured()) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("ai_conversations")
      .select("org_id, lead_id")
      .eq("conversation_id", conversationId)
      .maybeSingle();
    const row = data as Row | null;
    let orgId: unknown = row?.org_id ?? null;
    // Conversations predating the stamp_org_id trigger (or owner-less ones)
    // may lack the stamp — the lead row still knows its org.
    if (!orgId && row?.lead_id) {
      const { data: leadRow } = await admin
        .from("leads")
        .select("org_id")
        .eq("id", row.lead_id)
        .maybeSingle();
      orgId = (leadRow as Row | null)?.org_id ?? null;
    }
    return await loadOrgLike(admin, orgId);
  } catch {
    return null;
  }
}

/** Load one lead + its stamped organization by an EXACT lead id. Unambiguous. */
async function loadLeadAndOrgById(
  admin: AdminClient,
  leadId: string,
): Promise<{ lead: Lead; orgLike: AgentOrgLike | null } | null> {
  const { data: leadRow } = await admin
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .maybeSingle();
  if (!leadRow) return null;
  const row = leadRow as Row;
  return { lead: rowToLead(row), orgLike: await loadOrgLike(admin, row.org_id) };
}

/**
 * Last-resort match when we have no registration for this call at all. Fails
 * CLOSED on ambiguity: if the phone digits match leads in more than one
 * organization, we refuse to guess which one this call belongs to rather than
 * risk handing one tenant's homeowner data to another tenant's call.
 */
async function resolveByPhoneScoped(
  admin: AdminClient,
  digits: string,
): Promise<{ lead: Lead; orgLike: AgentOrgLike | null } | null> {
  if (digits.length < 10) return null;
  let candidates: Row[] = [];
  const { data: hit } = await admin
    .from("leads")
    .select("*")
    .ilike("phone", `%${digits}%`)
    .limit(20);
  candidates = (hit ?? []) as Row[];
  if (candidates.length === 0) {
    const { data: recent } = await admin
      .from("leads")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);
    candidates = (recent ?? []) as Row[];
  }
  const matches = candidates.filter((r) => last10(String(r.phone)) === digits);
  if (matches.length === 0) return null;

  const distinctOrgs = new Set(
    matches.map((r) => String(r.org_id ?? "")).filter(Boolean),
  );
  if (distinctOrgs.size > 1) {
    console.error(
      "[agent-context] phone number matches leads in multiple orgs — refusing to guess",
      { digits, orgCount: distinctOrgs.size },
    );
    return null;
  }

  const row = matches[0];
  return { lead: rowToLead(row), orgLike: await loadOrgLike(admin, row.org_id) };
}

export interface AgentContext {
  dynamicVariables: Record<string, string | number | boolean>;
  agentConfig: AgentConfig;
  /** The exact lead this call was resolved to, when known. */
  lead: Lead | null;
}

export async function resolveAgentContext(opts: {
  calledNumber: string;
  /** ElevenLabs conversation id — set the instant we placed this call. */
  conversationId?: string;
  callSid?: string;
  agentKey?: AgentKey;
  /**
   * Whether to allow the last-resort phone-number match (resolveByPhoneScoped)
   * when there's no call registration. This path can return a lead's PII for any
   * phone number, so the personalization webhook only enables it for signature-
   * verified requests — otherwise an unauthenticated caller could turn this into
   * a phone→PII oracle. Registration-based resolution (conversationId/callSid) is
   * always allowed. Defaults to true for internal callers.
   */
  allowPhoneFallback?: boolean;
}): Promise<AgentContext> {
  const { calledNumber, conversationId, callSid } = opts;
  const agentKey: AgentKey = opts.agentKey ?? "primary";
  const digits = last10(calledNumber);

  // Demo / no service role: match seed data; Sunrun → Emily.
  if (!isSupabaseConfigured() || !isAdminConfigured()) {
    const lead = demoLeads.find((l) => last10(l.phone) === digits) ?? null;
    return {
      dynamicVariables: lead ? agentVariablesForLead(lead) : currentDateVariables(),
      agentConfig: resolveAgentConfig(null, agentKey),
      lead,
    };
  }

  try {
    const admin = createAdminClient();

    // ── Primary: the call registration WE wrote at placement time ────────────
    // Exact — no phone matching, no cross-org ambiguity possible. Check the
    // in-memory registry first (instant, same-instance), then the durable
    // ai_conversations row (survives serverless cold starts / a different
    // instance having placed the call).
    let resolvedLeadId: string | null = null;
    if (conversationId) resolvedLeadId = getAICall(conversationId)?.leadId ?? null;
    if (!resolvedLeadId && callSid) resolvedLeadId = findByCallSid(callSid)?.leadId ?? null;
    if (!resolvedLeadId && conversationId) {
      const ref = await getConversationLeadRef(conversationId);
      resolvedLeadId = ref?.leadId ?? null;
    }

    let resolved: { lead: Lead; orgLike: AgentOrgLike | null } | null = null;
    if (resolvedLeadId) resolved = await loadLeadAndOrgById(admin, resolvedLeadId);
    // Last resort — a call we somehow have no registration for at all. Only when
    // the caller is trusted (a signature-verified webhook); otherwise this would
    // hand a lead's PII to any anonymous request that knows a phone number.
    if (!resolved && (opts.allowPhoneFallback ?? true)) {
      resolved = await resolveByPhoneScoped(admin, digits);
    }

    const dynamicVariables = resolved
      ? agentVariablesForLead(resolved.lead, {
          company: resolved.orgLike?.name,
          dialerTemplate: resolved.orgLike?.dialerTemplate,
        })
      : currentDateVariables();
    return {
      dynamicVariables,
      agentConfig: resolveAgentConfig(resolved?.orgLike ?? null, agentKey),
      lead: resolved?.lead ?? null,
    };
  } catch {
    return {
      dynamicVariables: currentDateVariables(),
      agentConfig: resolveAgentConfig(null, agentKey),
      lead: null,
    };
  }
}
