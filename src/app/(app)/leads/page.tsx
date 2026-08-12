import { Download, Users } from "lucide-react";
import { LeadsTable, type LeadsTableFilters } from "@/components/leads/leads-table";
import { GroupUploadGrid } from "@/components/leads/group-upload-grid";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { CalendarCheck, Sparkles, Zap } from "lucide-react";
import { getLeadsPage } from "@/lib/db/leads";
import { getCampaigns } from "@/lib/db/pipeline";
import { listLeadGroupsWithCounts } from "@/lib/db/lead-groups";
import { getViewer, listMembers } from "@/lib/org/membership";
import { isSolarVertical } from "@/lib/org/vertical";
import { leadStatusConfig } from "@/lib/status";
import type { LeadStatus } from "@/lib/types";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  // Filters live in the URL so pagination survives router.refresh() after
  // bulk actions, and so a filtered view is shareable/bookmarkable.
  const sp = await searchParams;
  const status =
    sp.status && sp.status in leadStatusConfig ? (sp.status as LeadStatus) : undefined;
  const filters: LeadsTableFilters = {
    q: sp.q?.trim() || undefined,
    status,
    smart: sp.smart || undefined,
    group: sp.group || undefined,
    campaignId: sp.campaign || undefined,
    uploaderId: sp.uploader || undefined,
    mine: sp.mine === "1",
  };
  const pageNum = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1);

  const [{ leads, total, stats, smartCounts, page, pageSize }, campaigns, viewer] =
    await Promise.all([
      getLeadsPage({ page: pageNum, ...filters }),
      getCampaigns(),
      getViewer(),
    ]);
  // The org's own intake groups (+ how many leads sit in each, and in the
  // Miscellaneous catch-all) drive both the upload tiles and the group filter.
  const { groups: leadGroups, miscCount } = await listLeadGroupsWithCounts(
    viewer.org?.id ?? null,
  );
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
        <GroupUploadGrid canImport={canManage} groups={leadGroups} miscCount={miscCount} />
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
      <GroupUploadGrid canImport={canManage} groups={leadGroups} miscCount={miscCount} />

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
