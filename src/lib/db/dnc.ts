import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { logDncEventForPhone } from "./lead-events";

// ─────────────────────────────────────────────────────────────────────────────
// Do-Not-Call / suppression list, per organization. Keyed on the last 10 digits
// (NANP) so formatting differences never split one number. Writes go through the
// service-role client after an application-code check; reads are also fine via
// the admin client here because every caller already resolved the org.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** Last 10 digits of a phone number — the suppression key. "" if not dialable. */
export function dncKey(phone: string): string {
  const d = (phone || "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

export interface DncEntry {
  id: string;
  phoneDigits: string;
  reason: string;
  source: string;
  createdAt: string;
}

/** The org's full suppression set (last-10 digits), for scrubbing lead lists. */
export async function getDncDigits(orgId: string | null): Promise<Set<string>> {
  if (!orgId || !isAdminConfigured()) return new Set();
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("dnc_numbers")
      .select("phone_digits")
      .eq("org_id", orgId);
    return new Set(((data ?? []) as Row[]).map((r) => String(r.phone_digits)));
  } catch {
    return new Set();
  }
}

/** Is a single number suppressed for this org? */
export async function isOnDnc(orgId: string | null, phone: string): Promise<boolean> {
  const key = dncKey(phone);
  if (!orgId || !key || !isAdminConfigured()) return false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("dnc_numbers")
      .select("id")
      .eq("org_id", orgId)
      .eq("phone_digits", key)
      .maybeSingle();
    return Boolean(data);
  } catch {
    return false;
  }
}

/** Add one number to the org's suppression list (idempotent upsert). */
export async function addToDnc(input: {
  orgId: string;
  phone: string;
  reason?: string | null;
  source?: string;
  createdBy?: string | null;
}): Promise<boolean> {
  const key = dncKey(input.phone);
  if (!input.orgId || !key || !isAdminConfigured()) return false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("dnc_numbers").upsert(
      {
        org_id: input.orgId,
        phone_digits: key,
        reason: input.reason ?? null,
        source: input.source ?? "manual",
        created_by: input.createdBy ?? null,
      },
      { onConflict: "org_id,phone_digits" },
    );
    // Timeline audit for any lead carrying this number. The suppression list is
    // keyed by phone, not lead id — the helper derives matching leads and skips
    // silently when none exist (an imported DNC number with no lead row).
    if (!error) {
      logDncEventForPhone({
        orgId: input.orgId,
        phone: input.phone,
        action: "added",
        reason: input.reason ?? null,
        source: input.source ?? "manual",
        actorId: input.createdBy ?? null,
      });
    }
    return !error;
  } catch {
    return false;
  }
}

/** Bulk-add numbers (CSV import). Returns how many distinct keys were written. */
export async function addManyToDnc(input: {
  orgId: string;
  phones: string[];
  source?: string;
  createdBy?: string | null;
}): Promise<number> {
  if (!input.orgId || !isAdminConfigured()) return 0;
  const keys = [...new Set(input.phones.map(dncKey).filter(Boolean))];
  if (!keys.length) return 0;
  try {
    const admin = createAdminClient();
    const rows = keys.map((phone_digits) => ({
      org_id: input.orgId,
      phone_digits,
      source: input.source ?? "import",
      created_by: input.createdBy ?? null,
    }));
    const { error } = await admin
      .from("dnc_numbers")
      .upsert(rows, { onConflict: "org_id,phone_digits" });
    return error ? 0 : keys.length;
  } catch {
    return 0;
  }
}

/** Remove one number from the org's suppression list. */
/**
 * Sources a customer's own "START" may lift. Texting START undoes a texting
 * opt-out — it does not undo a rep marking someone Do Not Call on a phone
 * call. Those are different requests from different conversations, and
 * "YES" is in START_WORDS, so a one-word reply could otherwise silently
 * re-open dialing on someone who asked a human to stop calling them.
 * A manual removal (no restriction) is still available in Admin.
 */
export const CUSTOMER_REVERSIBLE_SOURCES = ["sms_stop", "twilio_opt_out"];

export async function removeFromDnc(
  orgId: string,
  phone: string,
  opts?: { onlySources?: string[] },
): Promise<boolean> {
  const key = dncKey(phone);
  if (!orgId || !key || !isAdminConfigured()) return false;
  try {
    const admin = createAdminClient();
    let q = admin
      .from("dnc_numbers")
      .delete()
      .eq("org_id", orgId)
      .eq("phone_digits", key);
    if (opts?.onlySources?.length) q = q.in("source", opts.onlySources);
    const { error } = await q;
    if (!error) {
      logDncEventForPhone({ orgId, phone, action: "removed", source: "manual" });
    }
    return !error;
  } catch {
    return false;
  }
}

/** List the org's suppression entries, newest first (for the Admin screen). */
export async function listDnc(orgId: string | null, limit = 5000): Promise<DncEntry[]> {
  if (!orgId || !isAdminConfigured()) return [];
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("dnc_numbers")
      .select("id, phone_digits, reason, source, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return ((data ?? []) as Row[]).map((r) => ({
      id: String(r.id),
      phoneDigits: String(r.phone_digits ?? ""),
      reason: String(r.reason ?? ""),
      source: String(r.source ?? ""),
      createdAt: String(r.created_at ?? ""),
    }));
  } catch {
    return [];
  }
}

/** Drop every lead whose phone is on the suppression set. */
export function scrubDnc<T extends { phone: string }>(leads: T[], dnc: Set<string>): T[] {
  if (!dnc.size) return leads;
  return leads.filter((l) => {
    const key = dncKey(l.phone);
    return !key || !dnc.has(key);
  });
}
