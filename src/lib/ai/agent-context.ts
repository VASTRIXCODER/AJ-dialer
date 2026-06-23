import "server-only";

import { leads as demoLeads } from "../data";
import { agentVariablesForLead, currentDateVariables } from "../elevenlabs";
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
// inbound/outbound number, so the personalization webhook configures the agent
// from the matched lead's organization (Sunrun/solar → the Emily script).
// Best-effort and never throws.
// ─────────────────────────────────────────────────────────────────────────────

const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
type Row = Record<string, unknown>;

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

export interface AgentContext {
  dynamicVariables: Record<string, string | number | boolean>;
  agentConfig: AgentConfig;
}

export async function resolveAgentContextByPhone(
  calledNumber: string,
): Promise<AgentContext> {
  const digits = last10(calledNumber);

  // Demo / no service role: match seed data; Sunrun → Emily.
  if (!isSupabaseConfigured() || !isAdminConfigured()) {
    const lead = demoLeads.find((l) => last10(l.phone) === digits) ?? null;
    return {
      dynamicVariables: lead
        ? agentVariablesForLead(lead)
        : currentDateVariables(),
      agentConfig: resolveAgentConfig(null),
    };
  }

  try {
    const admin = createAdminClient();
    // Fast path: numbers stored E.164/digit-y; fallback: scan a bounded recent set.
    let candidates: Row[] = [];
    const { data: hit } = await admin
      .from("leads")
      .select("*")
      .ilike("phone", `%${digits}%`)
      .limit(5);
    candidates = (hit ?? []) as Row[];
    if (candidates.length === 0) {
      const { data: recent } = await admin
        .from("leads")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1000);
      candidates = (recent ?? []) as Row[];
    }
    const leadRow =
      candidates.find((r) => last10(String(r.phone)) === digits) ?? null;

    let orgLike: AgentOrgLike | null = null;
    let dynamicVariables: Record<string, string | number | boolean> =
      currentDateVariables();
    if (leadRow) {
      dynamicVariables = agentVariablesForLead(rowToLead(leadRow));
      const ownerId = String(leadRow.owner_id ?? "");
      if (ownerId) {
        const { data: prof } = await admin
          .from("profiles")
          .select("org_id")
          .eq("id", ownerId)
          .maybeSingle();
        if (prof?.org_id) {
          const { data: org } = await admin
            .from("organizations")
            .select("*")
            .eq("id", prof.org_id)
            .maybeSingle();
          if (org) orgLike = rowToOrgLike(org as Row);
        }
      }
    }
    return { dynamicVariables, agentConfig: resolveAgentConfig(orgLike) };
  } catch {
    return {
      dynamicVariables: currentDateVariables(),
      agentConfig: resolveAgentConfig(null),
    };
  }
}
