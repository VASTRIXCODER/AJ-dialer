import { NextResponse } from "next/server";
import { CSV_BOM, CSV_EOL } from "@/lib/csv-safety";
import { dncKey, getDncDigits } from "@/lib/db/dnc";
import { getFilteredLeadsPage } from "@/lib/db/leads-filter";
import { getScope, type Scope } from "@/lib/db/scope";
import {
  EXPORT_PAGE_SIZE,
  EXPORT_ROW_CAP,
  EXPORT_TRUNCATION_NOTE,
  exportCellKind,
  exportRowLine,
  formatExportCell,
  isExportTruncated,
  sanitizeExportSpec,
  type ActivityExportKey,
  type CoreExportKey,
  type ExportColumnKey,
  type ExportSpec,
} from "@/lib/leads/export-spec";
import { resolveLeadFields, type LeadFieldType } from "@/lib/leads/field-schema";
import { getViewer } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { count } from "@/lib/telemetry";
import type { Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Export v2 — POST an ExportSpec (columns + format + FilterSpec), stream back a
// CSV. Row selection reuses app_filter_leads through getFilteredLeadsPage, so
// an export can never disagree with what the same filter shows on screen; the
// activity columns (latest outcome, people, packs, next appointment/callback…)
// are batch-enriched per 1,000-row page with one IN() query per source — and
// only for sources a selected column actually needs.
//
// Gated on the dedicated `leads.export` permission (manager+ by default): the
// legacy GET /api/leads/export borrowed `leads.import`, but "walk off with the
// book, shaped however you like" deserves its own revocable switch.
//
// Every export lands one export_audit row (who, what columns, which filter,
// how many rows, truncated?) at stream end.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Per-lead extra leads-table columns the app Lead shape doesn't carry. */
interface LeadExtras {
  attemptCount: number;
  lastAttemptAt: string | null;
  sourceFile: string | null;
  dialingPreference: string;
}

/** Everything a page of rows was enriched with, keyed by lead id. */
interface EnrichCtx {
  extras: Map<string, LeadExtras>;
  latestCall: Map<string, { outcome: string | null; disposition: string | null }>;
  memberNames: Map<string, string>;
  packLabels: Map<string, string>;
  campaignNames: Map<string, string>;
  nextAppt: Map<string, string>;
  nextCb: Map<string, string>;
  dnc: Set<string>;
}

/** Which enrichment sources the selected columns actually require. */
function neededSources(keys: ReadonlySet<ExportColumnKey>) {
  const any = (...k: (CoreExportKey | ActivityExportKey)[]) => k.some((x) => keys.has(x));
  return {
    extras: any("attempt_count", "last_attempt_at", "import_file", "dialing_preference"),
    calls: any("latest_outcome", "latest_disposition"),
    members: any("assigned_rep_name", "owner_name"),
    packs: any("pack_label"),
    campaigns: any("campaign_name"),
    appointments: any("next_appointment_at"),
    callbacks: any("next_callback_at"),
    dnc: any("dnc_state"),
  };
}

type Sources = ReturnType<typeof neededSources>;

/**
 * Batch-enrich one page: one IN() query per needed source. The lookup caches
 * (members/packs/campaigns) persist across pages — only ids not seen yet are
 * fetched, so a 50k-row export still resolves each name once.
 */
async function enrichPage(
  leads: Lead[],
  scope: Scope,
  sources: Sources,
  ctx: EnrichCtx,
): Promise<void> {
  const admin = createAdminClient();
  const ids = leads.map((l) => l.id);
  const jobs: PromiseLike<unknown>[] = [];

  if (sources.extras) {
    jobs.push(
      admin
        .from("leads")
        .select("id, attempt_count, last_attempt_at, source_file, dialing_preference")
        .in("id", ids)
        .then(({ data }) => {
          for (const r of (data ?? []) as Row[]) {
            ctx.extras.set(String(r.id), {
              attemptCount: Number(r.attempt_count ?? 0),
              lastAttemptAt: r.last_attempt_at ? String(r.last_attempt_at) : null,
              sourceFile: r.source_file ? String(r.source_file) : null,
              dialingPreference: String(r.dialing_preference ?? "either"),
            });
          }
        }),
    );
  }

  if (sources.calls) {
    // ONE row per lead, picked in SQL. This was newest-first + first-wins over
    // `.in("lead_id", […1,000]).limit(20_000)` — and a limit above the
    // PostgREST response ceiling is not a limit. Measured: 3,201 leads have
    // calls, averaging 10.6 each, so a 1,000-lead page carries ~890 call rows
    // against a 1,000-row ceiling. Past it, truncation removed the tail, and
    // "latest outcome" exported BLANK for leads that plainly have call history.
    // DISTINCT ON applies the same ordering, so "latest" means what it did.
    jobs.push(
      admin
        .rpc("app_export_latest_call", { p_lead_ids: ids })
        .then(({ data }) => {
          for (const r of (data ?? []) as Row[]) {
            const id = String(r.lead_id ?? "");
            if (!id) continue;
            ctx.latestCall.set(id, {
              outcome: r.outcome ? String(r.outcome) : null,
              disposition: r.disposition ? String(r.disposition) : null,
            });
          }
        }),
    );
  }

  if (sources.members && scope.orgId) {
    const want = new Set<string>();
    for (const l of leads) {
      if (l.assignedRepId && !ctx.memberNames.has(l.assignedRepId)) want.add(l.assignedRepId);
      if (l.ownerId && !ctx.memberNames.has(l.ownerId)) want.add(l.ownerId);
    }
    if (want.size) {
      jobs.push(
        admin
          .from("organization_members")
          .select("user_id, name")
          .eq("org_id", scope.orgId)
          .in("user_id", [...want])
          .then(({ data }) => {
            for (const r of (data ?? []) as Row[]) {
              ctx.memberNames.set(String(r.user_id), String(r.name ?? ""));
            }
          }),
      );
    }
  }

  if (sources.packs) {
    const want = [
      ...new Set(leads.map((l) => l.leadPackId).filter((p): p is string => Boolean(p))),
    ].filter((p) => !ctx.packLabels.has(p));
    if (want.length) {
      jobs.push(
        admin
          .from("lead_packs")
          .select("id, label")
          .in("id", want)
          .then(({ data }) => {
            for (const r of (data ?? []) as Row[]) {
              ctx.packLabels.set(String(r.id), String(r.label ?? ""));
            }
          }),
      );
    }
  }

  if (sources.campaigns) {
    const want = [...new Set(leads.map((l) => l.campaignId).filter(Boolean))].filter(
      (c) => !ctx.campaignNames.has(c),
    );
    if (want.length) {
      jobs.push(
        admin
          .from("campaigns")
          .select("id, name")
          .in("id", want)
          .then(({ data }) => {
            for (const r of (data ?? []) as Row[]) {
              ctx.campaignNames.set(String(r.id), String(r.name ?? ""));
            }
          }),
      );
    }
  }

  if (sources.appointments) {
    // Soonest upcoming scheduled appointment per lead (asc + first-wins) —
    // same definition Lead 360 uses.
    // Same shape, same cap, and ASCENDING — so what truncation dropped here
    // was every FAR-FUTURE booking.
    jobs.push(
      admin
        .rpc("app_export_next_appointment", { p_lead_ids: ids })
        .then(({ data }) => {
          for (const r of (data ?? []) as Row[]) {
            const id = String(r.lead_id ?? "");
            if (!id || !r.scheduled_at) continue;
            ctx.nextAppt.set(id, String(r.scheduled_at));
          }
        }),
    );
  }

  if (sources.callbacks) {
    jobs.push(
      admin
        .rpc("app_export_next_callback", { p_lead_ids: ids })
        .then(({ data }) => {
          for (const r of (data ?? []) as Row[]) {
            const id = String(r.lead_id ?? "");
            if (!id || !r.due_at) continue;
            ctx.nextCb.set(id, String(r.due_at));
          }
        }),
    );
  }

  await Promise.all(jobs);
}

/** Raw value for one cell — stored keys stay stored keys; formatting is next. */
function cellValue(lead: Lead, key: ExportColumnKey, ctx: EnrichCtx): unknown {
  if (key.startsWith("custom:")) return lead.customFields?.[key.slice("custom:".length)];
  switch (key as CoreExportKey | ActivityExportKey) {
    case "first_name": return lead.firstName;
    case "last_name": return lead.lastName;
    case "phone": return lead.phone;
    case "email": return lead.email;
    case "address": return lead.address;
    case "city": return lead.city;
    case "state": return lead.state;
    case "county": return lead.county;
    case "zip": return lead.zip;
    case "timezone": return lead.timezone;
    case "status": return lead.status;
    case "lead_group": return lead.leadGroup;
    case "utility_provider": return lead.utilityProvider;
    case "solar_provider": return lead.solarProvider;
    case "utility_bill": return lead.utilityBill;
    case "solar_payment": return lead.solarPayment;
    case "has_ev": return lead.hasEV;
    case "has_pool": return lead.hasPool;
    case "has_battery": return lead.hasBattery;
    case "multiple_systems": return lead.multipleSystems;
    case "notes": return lead.notes;
    case "ai_score": return lead.aiScore;
    case "dialing_preference": return ctx.extras.get(lead.id)?.dialingPreference ?? "either";
    case "created_at": return lead.createdAt;
    case "last_contacted_at": return lead.lastContactedAt;
    case "latest_outcome": return ctx.latestCall.get(lead.id)?.outcome;
    case "latest_disposition": return ctx.latestCall.get(lead.id)?.disposition;
    case "assigned_rep_name":
      return lead.assignedRepId ? ctx.memberNames.get(lead.assignedRepId) : undefined;
    case "owner_name": return lead.ownerId ? ctx.memberNames.get(lead.ownerId) : undefined;
    case "pack_label": return lead.leadPackId ? ctx.packLabels.get(lead.leadPackId) : undefined;
    case "campaign_name": return ctx.campaignNames.get(lead.campaignId);
    case "attempt_count": return ctx.extras.get(lead.id)?.attemptCount ?? 0;
    case "last_attempt_at": return ctx.extras.get(lead.id)?.lastAttemptAt;
    case "next_appointment_at": return ctx.nextAppt.get(lead.id);
    case "next_callback_at": return ctx.nextCb.get(lead.id);
    case "dnc_state":
      // Suppressed by status OR by number on the org's list — "dnc" is the
      // stored-key style answer; anything else prints as the nullAs blank.
      return lead.status === "dnc" || ctx.dnc.has(dncKey(lead.phone)) ? "dnc" : undefined;
    case "import_file": return ctx.extras.get(lead.id)?.sourceFile;
    default: return undefined;
  }
}

/** Best-effort audit + telemetry at stream end — never fails the download. */
async function writeAudit(
  scope: Scope,
  spec: ExportSpec,
  rowCount: number,
  truncated: boolean,
): Promise<void> {
  try {
    await createAdminClient().from("export_audit").insert({
      org_id: scope.orgId,
      user_id: scope.userId,
      row_count: rowCount,
      columns: spec.columns.map((c) => c.key),
      filter: spec.filter,
      truncated,
    });
  } catch {
    /* audit is best-effort */
  }
  count("export.v2", 1, { orgId: scope.orgId, rows: rowCount, truncated });
}

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.user && !viewer.isDemo) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  if (!viewer.permissions.includes("leads.export")) {
    return NextResponse.json(
      { error: "You don't have permission to export. Ask a manager or admin." },
      { status: 403 },
    );
  }
  // Demo / degraded mode: there is no durable book (or no service key to read
  // it with) — a fabricated download would look like real data leaving the
  // building, so say what's missing instead.
  if (!isAdminConfigured()) {
    return NextResponse.json(
      {
        error:
          "Exports need a connected database. This workspace is running in demo mode — connect Supabase to enable exports.",
      },
      { status: 501 },
    );
  }

  const rl = rateLimit(`export-v2:${viewer.user?.id ?? clientIp(req)}`, 10, 5 * 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many exports — try again in a few minutes." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const scope = await getScope();
  if (!scope) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  // The org's resolved schema is the custom-key allowlist AND the type map
  // (booleans → Yes/No, dates → the chosen date format).
  const defs = resolveLeadFields(
    viewer.org?.settings.leadFields,
    templateProfile(viewer.org?.dialerTemplate).fields,
  );
  const customDefs = defs.filter((d) => d.source === "custom");
  const customTypes: Record<string, LeadFieldType> = {};
  for (const d of customDefs) customTypes[d.key] = d.type;

  const body = (await req.json().catch(() => null)) as unknown;
  const spec = sanitizeExportSpec(body, customDefs.map((d) => d.key));
  if (!spec) {
    return NextResponse.json(
      { error: "That export has no valid columns." },
      { status: 400 },
    );
  }

  const keySet = new Set(spec.columns.map((c) => c.key));
  const sources = neededSources(keySet);
  const kinds = spec.columns.map((c) => exportCellKind(c.key, customTypes));

  const ctx: EnrichCtx = {
    extras: new Map(),
    latestCall: new Map(),
    memberNames: new Map(),
    packLabels: new Map(),
    campaignNames: new Map(),
    nextAppt: new Map(),
    nextCb: new Map(),
    dnc: sources.dnc ? await getDncDigits(scope.orgId) : new Set(),
  };

  // null filter = "everything in your scope": an empty spec compiles to no
  // WHERE fragments, so the RPC applies scope + the archived exclusion only.
  const filter = spec.filter ?? { op: "and" as const, groups: [] };
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        if (spec.format.bom) controller.enqueue(encoder.encode(CSV_BOM));
        controller.enqueue(
          encoder.encode(exportRowLine(spec.columns.map((c) => c.header), spec.format) + CSV_EOL),
        );

        let offset = 0;
        let written = 0;
        let total = 0;
        while (written < EXPORT_ROW_CAP) {
          const page = await getFilteredLeadsPage(scope, {
            filter,
            offset,
            limit: EXPORT_PAGE_SIZE,
          });
          total = page.total;
          if (page.leads.length === 0) break;
          await enrichPage(page.leads, scope, sources, ctx);

          let chunk = "";
          for (const lead of page.leads) {
            if (written >= EXPORT_ROW_CAP) break;
            const cells = spec.columns.map((c, i) =>
              formatExportCell(cellValue(lead, c.key, ctx), kinds[i], spec.format),
            );
            chunk += exportRowLine(cells, spec.format) + CSV_EOL;
            written += 1;
          }
          controller.enqueue(encoder.encode(chunk));

          offset += page.leads.length;
          if (offset >= total || page.leads.length < EXPORT_PAGE_SIZE) break;
        }

        const truncated = isExportTruncated(total);
        if (truncated) {
          controller.enqueue(encoder.encode(EXPORT_TRUNCATION_NOTE + CSV_EOL));
        }
        await writeAudit(scope, spec, written, truncated);
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  const name = `${slug(viewer.org?.name ?? "export") || "export"}-export-${date}.csv`;
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
