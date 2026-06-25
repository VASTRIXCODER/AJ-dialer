import { Download, Users } from "lucide-react";
import { LeadsTable } from "@/components/leads/leads-table";
import { CsvImport } from "@/components/leads/csv-import";
import { MetricCard } from "@/components/dashboard/metric-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CalendarCheck, Sparkles, Zap } from "lucide-react";
import { getLeads } from "@/lib/db/leads";
import { getCampaigns } from "@/lib/db/pipeline";
import { getViewer } from "@/lib/org/membership";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Leads" };
export const dynamic = "force-dynamic";

export default async function LeadsPage() {
  const [leads, campaigns, viewer] = await Promise.all([
    getLeads(),
    getCampaigns(),
    getViewer(),
  ]);
  // Lead management (delete) is for managers+ (anyone who can import leads).
  const canManage = viewer.permissions.includes("leads.import");
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
      <CsvImport variant="button" campaigns={campaignList} />
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
        <EmptyState
          icon={Users}
          title="No leads yet"
          description="Import a CSV or connect your CRM to start building your dialing queue."
          action={{ label: "Import leads", href: "/admin" }}
        />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {header}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total leads" value={formatNumber(leads.length)} icon={Users} accent="primary" />
        <MetricCard label="Qualified" value={formatNumber(qualified)} icon={Zap} accent="success" />
        <MetricCard label="Appointments" value={formatNumber(appointmentsCount)} icon={CalendarCheck} accent="accent" />
        <MetricCard label="Avg AI score" value={String(avgScore)} icon={Sparkles} accent="warning" />
      </div>

      <LeadsTable leads={leads} campaigns={campaignList} canManage={canManage} />
    </PageContainer>
  );
}
