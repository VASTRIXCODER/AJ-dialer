import { Activity, PhoneCall, Radio, Users } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { AiLiveMonitor } from "@/components/monitor/ai-live-monitor";
import { MonitorGrid } from "@/components/monitor/monitor-grid";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { activeCalls, reps } from "@/lib/data";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";

export const metadata = { title: "Live Monitor" };

export default async function MonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ call?: string }>;
}) {
  const { call } = await searchParams;
  const connected = activeCalls.filter((c) => c.state === "connected").length;
  const onCall = reps.filter((r) => r.status === "on_call").length;
  const available = reps.filter((r) => r.status === "available").length;
  const aiConfigured = isElevenLabsConfigured();

  return (
    <PageContainer>
      <PageHeader
        title="Live Monitor"
        description="Watch the floor in real time — AI and human calls. Listen in, whisper-coach, or take over a live AI call instantly."
      >
        <Badge tone="success" dot>
          {connected} human · live
        </Badge>
      </PageHeader>

      {/* AI agent calls — always present; intervene in real time */}
      <AiLiveMonitor configured={aiConfigured} initialCall={call ?? null} />

      {/* Human rep calls */}
      {activeCalls.length > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard label="Active calls" value={String(activeCalls.length)} icon={Radio} accent="primary" />
            <MetricCard label="Connected" value={String(connected)} icon={PhoneCall} accent="success" />
            <MetricCard label="Reps on call" value={String(onCall)} icon={Activity} accent="accent" />
            <MetricCard label="Available" value={String(available)} icon={Users} accent="warning" />
          </div>

          <div>
            <h3 className="mb-4 text-lg font-semibold tracking-tight">Rep calls</h3>
            <MonitorGrid calls={activeCalls} />
          </div>
        </>
      ) : (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No human reps are on calls right now.
        </Card>
      )}
    </PageContainer>
  );
}
