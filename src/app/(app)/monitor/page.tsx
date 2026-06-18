import { Activity, PhoneCall, Radio, Users } from "lucide-react";
import { MonitorGrid } from "@/components/monitor/monitor-grid";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { activeCalls, reps } from "@/lib/data";

export const metadata = { title: "Live Monitor" };

export default function MonitorPage() {
  const connected = activeCalls.filter((c) => c.state === "connected").length;
  const onCall = reps.filter((r) => r.status === "on_call").length;
  const available = reps.filter((r) => r.status === "available").length;

  return (
    <PageContainer>
      <PageHeader
        title="Live Monitor"
        description="Watch the floor in real time — listen in, whisper coach, and track every active conversation."
      >
        <Badge tone="success" dot>
          {connected} connected
        </Badge>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricCard label="Active calls" value={String(activeCalls.length)} icon={Radio} accent="primary" />
        <MetricCard label="Connected" value={String(connected)} icon={PhoneCall} accent="success" />
        <MetricCard label="Reps on call" value={String(onCall)} icon={Activity} accent="accent" />
        <MetricCard label="Available" value={String(available)} icon={Users} accent="warning" />
      </div>

      <MonitorGrid calls={activeCalls} />
    </PageContainer>
  );
}
