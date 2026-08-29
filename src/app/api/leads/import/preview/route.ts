import { NextResponse } from "next/server";
import { dncKey, getDncDigits } from "@/lib/db/dnc";
import { decideImportAction, normalizeDedupeMode } from "@/lib/db/lead-import";
import { parseCsvToLeads, sanitizeColumnPlan } from "@/lib/leads/parse-request";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { isValidPhone } from "@/lib/utils";

export const dynamic = "force-dynamic";

const MAX_CSV_BYTES = 3_500_000;

/**
 * Dry-run one chunk of an import: parse it under the chosen plan and answer
 * "what WOULD happen" — created / updated / skipped / suppressed / invalid —
 * using the same app_phone_matches probe and DNC set the real write uses.
 * Writes NOTHING. This is the Import Studio's dedupe-step reality check, so a
 * manager sees "3,800 create, 150 update, 50 already suppressed" before
 * committing to a mode.
 */
export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return NextResponse.json(
      { error: "You don't have permission to import leads." },
      { status: 403 },
    );
  }
  const rl = rateLimit(`import-preview:${viewer.user?.id ?? clientIp(req)}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many dry runs in a row — wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    csv?: string;
    hasHeader?: boolean;
    delimiter?: string;
    columnPlan?: unknown;
    dedupeMode?: string;
  };
  if (typeof body.csv !== "string" || !body.csv.trim()) {
    return NextResponse.json({ error: "That file looks empty." }, { status: 400 });
  }
  if (body.csv.length > MAX_CSV_BYTES) {
    return NextResponse.json(
      { error: "Dry-run one chunk at a time (≤3.5 MB)." },
      { status: 413 },
    );
  }

  const DELIMS = new Set([",", ";", "\t", "|"]);
  const parsed = await parseCsvToLeads(body.csv, {
    plan: sanitizeColumnPlan(body.columnPlan),
    hasHeader: typeof body.hasHeader === "boolean" ? body.hasHeader : undefined,
    delimiter:
      typeof body.delimiter === "string" && DELIMS.has(body.delimiter)
        ? body.delimiter
        : undefined,
  });
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const mode = normalizeDedupeMode(body.dedupeMode);
  const orgId = viewer.org?.id ?? null;
  const dncSet = await getDncDigits(orgId);

  const last10 = (s: string) => (s || "").replace(/\D/g, "").slice(-10);
  const digitsOf = parsed.leads.map((l) => last10(l.phone));
  const unique = [...new Set(digitsOf.filter((d) => d.length === 10))];

  // Same probe the real write uses — one indexed lookup for the whole chunk.
  const existing = new Map<string, string>();
  if (orgId && unique.length && isAdminConfigured()) {
    try {
      const { data } = await createAdminClient().rpc("app_phone_matches", {
        p_org: orgId,
        p_digits: unique,
      });
      for (const m of (data ?? []) as { digits: string; lead_id: string }[]) {
        if (!existing.has(String(m.digits))) {
          existing.set(String(m.digits), String(m.lead_id));
        }
      }
    } catch {
      // Demo / RPC unavailable: preview degrades to "everything creates".
    }
  }

  let wouldCreate = 0;
  let wouldUpdate = 0;
  let wouldSkip = 0;
  let dnc = 0;
  let invalid = 0;
  const seen = new Set<string>();
  const updating = new Set<string>();
  for (let i = 0; i < parsed.leads.length; i++) {
    const lead = parsed.leads[i];
    const digits = digitsOf[i];
    if (!isValidPhone(lead.phone)) invalid++;
    if (digits.length === 10 && dncSet.has(dncKey(lead.phone))) {
      dnc++;
      continue; // the real import scrubs these before writing
    }
    const action = decideImportAction({
      digits,
      existingLeadId: existing.get(digits) ?? null,
      seenInBatch: seen.has(digits),
      mode,
    });
    if (digits.length === 10) seen.add(digits);
    if (action === "create") wouldCreate++;
    else if (action === "update") {
      const id = existing.get(digits)!;
      if (updating.has(id)) wouldSkip++;
      else {
        updating.add(id);
        wouldUpdate++;
      }
    } else wouldSkip++;
  }

  return NextResponse.json({
    wouldCreate,
    wouldUpdate,
    wouldSkip,
    dnc,
    invalid,
    rows: parsed.fileRows,
    skippedRows: parsed.skippedRows,
    source: parsed.source,
  });
}
