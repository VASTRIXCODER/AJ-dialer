import { ArrowLeft, CalendarCheck, PhoneCall, PhoneOutgoing, Target, Users, Zap } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ReportFunnel } from "@/components/reports/report-sections";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { getCampaign } from "@/lib/db/pipeline";
import { formatNumber } from "@/lib/utils";

export const dynamic = "force-dynamic";

const tone = {
  active: { tone: "success" as const, label: "Active" },
  paused: { tone: "warning" as const, label: "Paused" },
  completed: { tone: "neutral" as const, label: "Completed" },
};

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) notFound();

  const st = c.stats;
  const cfg = tone[c.status];
  const apptRate = st.connects
    ? Math.round((st.appointments / st.connects) * 1000) / 10
    : 0;

  return (
    <PageContainer>
      <Link
        href="/campaigns"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All campaigns
      </Link>

      <div className="flex items-center gap-3">
        <span className="h-10 w-2 rounded-full" style={{ background: c.color }} />
        <PageHeader title={c.name} description={c.utilityProvider || "All providers"}>
          <Badge tone={cfg.tone} dot>
            {cfg.label}
          </Badge>
          <Link
            href={`/dialer?campaign=${c.id}`}
            className={buttonVariants({ size: "sm", className: "gap-2" })}
          >
            <PhoneCall className="h-4 w-4" />
            Dial this campaign
          </Link>
        </PageHeader>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Leads" value={formatNumber(st.totalLeads)} icon={Users} accent="primary" />
        <MetricCard label="Dialable" value={formatNumber(st.dialableLeads)} icon={PhoneOutgoing} accent="accent" />
        <MetricCard label="Contacted" value={formatNumber(st.contactedLeads)} icon={Users} accent="primary" />
        <MetricCard label="Calls" value={formatNumber(st.calls)} icon={PhoneCall} accent="warning" />
        <MetricCard label="Connect rate" value={`${st.connectRate}%`} icon={Zap} accent="accent" />
        <MetricCard label="Appointments" value={formatNumber(st.appointments)} icon={CalendarCheck} accent="success" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SectionCard title="Conversion funnel" description="Calls → connects → appointments">
          <ReportFunnel
            funnel={{
              dials: st.calls,
              connects: st.connects,
              appointments: st.appointments,
              connectRate: st.connectRate,
              apptRate,
            }}
          />
        </SectionCard>

        <SectionCard title="Lead pipeline" description="How this campaign's leads are progressing">
          <div className="space-y-3">
            <PipeRow label="Total leads" value={st.totalLeads} of={st.totalLeads} icon={Users} />
            <PipeRow label="Contacted" value={st.contactedLeads} of={st.totalLeads} icon={PhoneCall} />
            <PipeRow label="Still dialable" value={st.dialableLeads} of={st.totalLeads} icon={PhoneOutgoing} />
            <PipeRow label="Appointments" value={st.appointments} of={st.totalLeads} icon={Target} />
          </div>
          {st.totalLeads === 0 && (
            <p className="mt-3 text-sm text-muted-foreground">
              No leads assigned yet — assign some from the Leads tab or on CSV import.
            </p>
          )}
        </SectionCard>
      </div>
    </PageContainer>
  );
}

function PipeRow({
  label,
  value,
  of,
  icon: Icon,
}: {
  label: string;
  value: number;
  of: number;
  icon: typeof Users;
}) {
  const pct = of > 0 ? Math.round((value / of) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          {label}
        </span>
        <span className="font-semibold tabular">{formatNumber(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
