import { Download, Users } from "lucide-react";
import { LeadsTable } from "@/components/leads/leads-table";
import { GroupUploadGrid } from "@/components/leads/group-upload-grid";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CalendarCheck, Sparkles, Zap } from "lucide-react";
import { getLeads } from "@/lib/db/leads";
import { getCampaigns } from "@/lib/db/pipeline";
import { getViewer, listMembers } from "@/lib/org/membership";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const [leads, campaigns, viewer] = await Promise.all([
    getLeads(),
    getCampaigns(),
    getViewer(),
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
  const qualified = leads.filter(
    (l) => l.status === "qualified" || l.status === "appointment",
  ).length;
  const appointmentsCount = leads.filter(
    (l) => l.status === "appointment",
  ).length;
  const avgScore = leads.length
    ? Math.round(leads.reduce((a, l) => a + (l.aiScore ?? 0), 0) / leads.length)
    : 0;

  const header = (
    <PageHeader
      title="Leads"
      description="Every homeowner in your pipeline, scored and ready to dial."
    >
      <Button variant="outline" size="sm" className="gap-2">
        <Download className="h-4 w-4" />
        Export
      </Button>
    </PageHeader>
  );

  if (leads.length === 0) {
    return (
      <PageContainer>
        {header}
        <GroupUploadGrid canImport={canManage} labelOverrides={groupLabels} />
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
      <GroupUploadGrid canImport={canManage} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total leads" value={formatNumber(leads.length)} icon={Users} accent="primary" />
        <MetricCard label="Qualified" value={formatNumber(qualified)} icon={Zap} accent="success" />
        {/* Labeled "In appointment stage" — NOT "Appointments" — because this
            counts LEADS whose status is 'appointment', a different number from
            the Reports/Dashboard "Appointments" KPI (booked appointment ROWS).
            Three screens once showed three different "Appointments" totals. */}
        <MetricCard label="In appointment stage" value={formatNumber(appointmentsCount)} icon={CalendarCheck} accent="accent" />
        <MetricCard label="Avg AI score" value={String(avgScore)} icon={Sparkles} accent="warning" />
      </div>

      <LeadsTable
        leads={leads}
        campaigns={campaignList}
        canManage={canManage}
        meId={viewer.user?.id ?? null}
        members={members}
        labelOverrides={groupLabels}
      />
    </PageContainer>
  );
}
