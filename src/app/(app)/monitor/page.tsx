import { AiLiveMonitor } from "@/components/monitor/ai-live-monitor";
import { HumanLiveMonitor } from "@/components/monitor/human-live-monitor";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
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

  return (
    <PageContainer>
      <PageHeader
        title="Live Monitor"
        description="Watch every call in real time — AI and human. Listen in, oversee the transcript, take over, or end and categorize it from one place."
      />

      {/* AI agent calls — the primary live view */}
      <AiLiveMonitor configured={aiConfigured} initialCall={call ?? null} />

      {/* Human rep calls — appears only when a manual call is live */}
      <HumanLiveMonitor />
    </PageContainer>
  );
}
