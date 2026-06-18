import { Download, Upload, Users } from "lucide-react";
import { LeadsTable } from "@/components/leads/leads-table";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CalendarCheck, Sparkles, Zap } from "lucide-react";
import { leads } from "@/lib/data";
import { formatNumber } from "@/lib/utils";

export const metadata = { title: "Leads" };

export default function LeadsPage() {
  const qualified = leads.filter(
    (l) => l.status === "qualified" || l.status === "appointment",
  ).length;
  const avgScore = Math.round(
    leads.reduce((a, l) => a + (l.aiScore ?? 0), 0) / leads.length,
  );

  return (
    <PageContainer>
      <PageHeader
        title="Leads"
        description="Every homeowner in your pipeline, scored and ready to dial."
      >
        <Button variant="outline" size="sm" className="gap-2">
          <Upload className="h-4 w-4" />
          Import CSV
        </Button>
        <Button variant="outline" size="sm" className="gap-2">
          <Download className="h-4 w-4" />
          Export
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Total leads" value={formatNumber(leads.length * 312)} icon={Users} accent="primary" />
        <MetricCard label="Qualified" value={formatNumber(qualified * 184)} icon={Zap} accent="success" />
        <MetricCard label="Appointments" value={formatNumber(412)} icon={CalendarCheck} accent="accent" />
        <MetricCard label="Avg AI score" value={String(avgScore)} icon={Sparkles} accent="warning" />
      </div>

      <LeadsTable leads={leads} />
    </PageContainer>
  );
}
