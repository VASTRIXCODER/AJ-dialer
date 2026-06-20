import { Activity, PhoneCall, Radio, Users } from "lucide-react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { AiLiveMonitor } from "@/components/monitor/ai-live-monitor";
import { MonitorGrid } from "@/components/monitor/monitor-grid";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { activeCalls, reps } from "@/lib/data";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";

export const metadata = { title: "Live Monitor" };
export const dynamic = "force-dynamic";

export default async function MonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ call?: string }>;
}) {
  const { call } = await searchParams;
  const aiConfigured = isElevenLabsConfigured();

  // Human-rep monitoring is only meaningful when reps are actually on live calls
  // (manual mode). In the AI-first default it stays hidden rather than showing an
  // empty placeholder.
  const connected = activeCalls.filter((c) => c.state === "connected").length;
  const onCall = reps.filter((r) => r.status === "on_call").length;
  const available = reps.filter((r) => r.status === "available").length;
  const showHuman = activeCalls.length > 0;

  return (
    <PageContainer>
      <PageHeader
        title="Live Monitor"
        description="Watch every AI call in real time — listen in, oversee the transcript, take over, or end and categorize it from one place."
      />

      {/* AI agent calls — the primary live view */}
      <AiLiveMonitor configured={aiConfigured} initialCall={call ?? null} />

      {/* Human rep calls — only when manual calls are live */}
      {showHuman && (
        <section className="space-y-4 border-t border-border pt-6">
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
        </section>
      )}
    </PageContainer>
  );
}
