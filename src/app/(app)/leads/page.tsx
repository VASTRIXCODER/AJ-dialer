import { Download, Users } from "lucide-react";
import { LeadsTable, type LeadsTableFilters } from "@/components/leads/leads-table";
import { GroupUploadGrid } from "@/components/leads/group-upload-grid";
import { LeadPacksPanel } from "@/components/leads/lead-packs-panel";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { CalendarCheck, Sparkles, Zap } from "lucide-react";
import {
  getLeadsPage,
  getMissingCountyCount,
  listDistinctCounties,
  type LeadsSort,
} from "@/lib/db/leads";
import { getCampaigns } from "@/lib/db/pipeline";
import { listLeadGroupsWithCounts } from "@/lib/db/lead-groups";
import { resolveLeadFields, type CoreFieldOverrides } from "@/lib/leads/field-schema";
import { getViewer, listMembers } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";
import { isSolarVertical } from "@/lib/org/vertical";
import { leadStatusConfig } from "@/lib/status";
import type { LeadStatus } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The sort keys app_leads_page's CASE whitelist accepts — anything else never
 *  leaves this page. The SQL re-validates anyway (defense in depth). */
const SORTABLE = new Set([
  "name",
  "city",
  "state",
  "status",
  "utility_bill",
  "solar_payment",
  "ai_score",
  "last_contacted_at",
  "created_at",
]);

/** Parse `?sort=key.dir` — unknown keys and malformed values drop to undefined
 *  (upload order) rather than forwarding user input to the RPC. */
function parseSort(raw: string | undefined): LeadsSort | undefined {
  if (!raw) return undefined;
  const dot = raw.indexOf(".");
  const key = dot > 0 ? raw.slice(0, dot) : raw;
  if (!SORTABLE.has(key)) return undefined;
  return { key, dir: raw.slice(dot + 1) === "desc" ? "desc" : "asc" };
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Filters live in the URL so pagination survives router.refresh() after
  // bulk actions, and so a filtered view is shareable/bookmarkable.
  const raw = await searchParams;
  // The App Router delivers a REPEATED param as an array — take the first
  // rather than crashing on ['smith','jones'].trim().
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)]));
  const status =
    sp.status && sp.status in leadStatusConfig ? (sp.status as LeadStatus) : undefined;
  // A malformed ?uploader= would fail the RPC's uuid cast and render the whole
  // book as the onboarding empty state — validate instead of forwarding.
  const uploaderId = sp.uploader && UUID.test(sp.uploader) ? sp.uploader : undefined;
  const sort = parseSort(sp.sort);
  const filters: LeadsTableFilters = {
    q: sp.q?.trim() || undefined,
    status,
    smart: sp.smart || undefined,
    group: sp.group || undefined,
    county: sp.county || undefined,
    campaignId: sp.campaign || undefined,
    uploaderId,
    mine: sp.mine === "1",
    // The VALIDATED value goes back to the table, so its headers only ever
    // reflect a sort the server actually applied.
    sort: sort ? `${sort.key}.${sort.dir}` : undefined,
  };
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  let [pageData, campaigns, viewer, counties] = await Promise.all([
    getLeadsPage({ page: pageNum, ...filters, sort }),
    getCampaigns(),
    getViewer(),
    listDistinctCounties(),
  ]);
  // Out-of-range page (stale bookmark, or the last row of the last page was
  // just deleted and router.refresh() kept ?page=N): clamp to the real last
  // page instead of rendering a book that looks empty.
  if (pageData.leads.length === 0 && pageData.total > 0 && pageNum > 1) {
    const lastPage = Math.max(1, Math.ceil(pageData.total / pageData.pageSize));
    if (lastPage < pageNum) {
      pageData = await getLeadsPage({ page: lastPage, ...filters, sort });
    }
  }
  const { leads, total, stats, smartCounts, page, pageSize } = pageData;
  // The org's own intake groups (+ how many leads sit in each, and in the
  // Miscellaneous catch-all) drive both the upload tiles and the group filter.
  // missingCountyCount rides alongside it — both are org-scoped HEAD counts
  // that only Edit groups needs, gated behind the same canManage check.
  const [{ groups: leadGroups, miscCount }, missingCountyCount] = await Promise.all([
    listLeadGroupsWithCounts(viewer.org?.id ?? null),
    getMissingCountyCount(viewer.org?.id ?? null),
  ]);
  // Lead management (delete / reassign) is for managers+ (leads.import). Pull the
  // org's members so a supervisor can reassign leads between accounts.
  const canManage = viewer.permissions.includes("leads.import");
  // Per-org "dropbox" label overrides (display only) — e.g. show "San Antonio"
  // where the underlying bucket key is still "fresno".
  const groupLabels = viewer.org?.settings.leadGroupLabels ?? {};
  const members =
    canManage && viewer.org
      ? (await listMembers(viewer.org.id)).map((m) => ({ id: m.userId, name: m.name }))
      : [];
  const campaignList = campaigns
    .filter((c) => c.status !== "completed")
    .map((c) => ({ id: c.id, name: c.name }));

  // The org's effective lead-field schema: explicit settings.leadFields when
  // saved (imports/Admin), otherwise the core slots with the dialer template's
  // relabels/hides applied. TemplateProfile.fields ships with the templates
  // half of this epic — read it defensively so either half builds alone.
  const fields = resolveLeadFields(
    viewer.org?.settings.leadFields,
    (templateProfile(viewer.org?.dialerTemplate) as { fields?: CoreFieldOverrides })
      .fields,
  );

  const header = (
    <PageHeader
      title="Leads"
      description="Every homeowner in your pipeline, scored and ready to dial."
    >
      {/* Hidden for reps: /api/leads/export is gated on leads.import, so showing
          it to everyone would just hand a rep a 403 page. */}
      {canManage && (
        <a
          href="/api/leads/export"
          download
          className={buttonVariants({ variant: "outline", size: "sm", className: "gap-2" })}
        >
          <Download className="h-4 w-4" />
          Export CSV
        </a>
      )}
    </PageHeader>
  );

  // Scope-wide total, not the current page/filter — an empty BOOK gets the
  // onboarding empty state; an empty filter result renders inside the table.
  if (stats.total === 0) {
    return (
      <PageContainer>
        {header}
        <GroupUploadGrid
          canImport={canManage}
          groups={leadGroups}
          miscCount={miscCount}
          missingCountyCount={missingCountyCount}
        />
        <EmptyState
          icon={Users}
          title="No leads yet"
          description={
            canManage
              ? "Import a CSV above, or connect your CRM to start building your dialing queue."
              : "Ask a manager or admin to import leads to start building your dialing queue."
          }
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {header}
      <GroupUploadGrid
        canImport={canManage}
        groups={leadGroups}
        miscCount={miscCount}
        missingCountyCount={missingCountyCount}
      />
      {canManage && <LeadPacksPanel members={members} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total leads" value={formatNumber(stats.total)} icon={Users} accent="primary" />
        <MetricCard label="Qualified" value={formatNumber(stats.qualified)} icon={Zap} accent="success" />
        {/* Labeled "In appointment stage" — NOT "Appointments" — because this
            counts LEADS whose status is 'appointment', a different number from
            the Reports/Dashboard "Appointments" KPI (booked appointment ROWS).
            Three screens once showed three different "Appointments" totals. */}
        <MetricCard label="In appointment stage" value={formatNumber(stats.appointments)} icon={CalendarCheck} accent="accent" />
        <MetricCard label="Avg AI score" value={String(stats.avgScore)} icon={Sparkles} accent="warning" />
      </div>

      <LeadsTable
        leads={leads}
        total={total}
        page={page}
        pageSize={pageSize}
        smartCounts={smartCounts}
        filters={filters}
        campaigns={campaignList}
        canManage={canManage}
        meId={viewer.user?.id ?? null}
        members={members}
        labelOverrides={groupLabels}
        orgGroups={leadGroups.map((g) => ({ key: g.key, label: g.label }))}
        orgCounties={counties}
        fields={fields}
        // Both signals, one prop: a non-solar vertical drops the solar fields
        // outright, and a solar org can still switch them off per-tenant.
        showSolarPayment={
          isSolarVertical(viewer.org?.dialerTemplate) &&
          (viewer.org?.settings.qualify?.showSolarPayment ?? true)
        }
      />
    </PageContainer>
  );
}
