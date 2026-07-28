import "server-only";

import { CAMPAIGN_CERT_TEXT, CAMPAIGN_CERT_VERSION } from "./versions";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Normalizes a client-supplied campaign id: a real UUID, or null (the org-wide
 *  "no campaign" bucket for ad-hoc / manual-group imports). Anything else
 *  (legacy free-text campaign ids) also falls to the org-wide bucket rather
 *  than erroring — certification is a compliance gate, not a data validator. */
export function normalizeCampaignId(v: unknown): string | null {
  return typeof v === "string" && UUID.test(v) ? v : null;
}

/**
 * Has this org certified the given campaign (or its org-wide "no campaign"
 * bucket) at the CURRENT certification version? A version bump makes every
 * prior certification stale, so every org must re-certify once, org-wide.
 */
export async function hasCurrentCertification(
  orgId: string,
  campaignId: string | null,
): Promise<boolean> {
  if (!isAdminConfigured()) return true; // no service role — don't hard-block demo/local use
  try {
    const admin = createAdminClient();
    let q = admin
      .from("campaign_certifications")
      .select("id")
      .eq("org_id", orgId)
      .eq("version", CAMPAIGN_CERT_VERSION);
    q = campaignId ? q.eq("campaign_id", campaignId) : q.is("campaign_id", null);
    const { data, error } = await q.limit(1).maybeSingle();
    // FAIL OPEN on any query error. supabase-js does NOT throw when the table is
    // missing or unreachable — it resolves with { data: null, error }. Reading
    // only `data` therefore turned "schema not migrated yet" into "nobody has
    // certified", which 403'd EVERY import in every org, with no way out (the
    // certify insert failed for the same reason). A gate that can't be evaluated
    // must not block: the catch below never fired, so the check has to be here.
    if (error) return true;
    return Boolean(data);
  } catch {
    return true; // fail open — a DB hiccup must never brick every import
  }
}

/**
 * Records a certification. Idempotent in effect (hasCurrentCertification only
 * needs ONE current-version row to pass), so this is a plain insert — no
 * upsert/conflict handling needed, and a rare double-submit just adds a second
 * harmless audit row rather than risking a lost certification under a race.
 */
export async function recordCertification(input: {
  orgId: string;
  campaignId: string | null;
  certifiedBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: true };
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("campaign_certifications").insert({
      org_id: input.orgId,
      campaign_id: input.campaignId,
      certified_by: input.certifiedBy,
      version: CAMPAIGN_CERT_VERSION,
      cert_text: CAMPAIGN_CERT_TEXT,
    });
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to record certification." };
  }
}
