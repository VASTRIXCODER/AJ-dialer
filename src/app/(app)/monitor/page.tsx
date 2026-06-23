import { Radio } from "lucide-react";
import { AiLiveMonitor } from "@/components/monitor/ai-live-monitor";
import { HumanLiveMonitor } from "@/components/monitor/human-live-monitor";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { getViewer } from "@/lib/org/membership";

export const metadata = { title: "Live Monitor" };
export const dynamic = "force-dynamic";

export default async function MonitorPage({
  searchParams,
}: {
  searchParams: Promise<{ call?: string }>;
}) {
  const { call } = await searchParams;

  // Live monitoring is for supervisors (manager / admin / owner). Reps are
  // blocked here — enforced at the page, not just hidden in the nav.
  const viewer = await getViewer();
  if (!viewer.permissions.includes("monitor.view")) {
    return (
      <PageContainer>
        <PageHeader
          title="Live Monitor"
          description="Oversee live calls between your reps and customers."
        />
        <EmptyState
          icon={Radio}
          title="Live monitoring is for supervisors"
          description="Listening in on live calls is available to managers and admins. Ask an admin if you need access."
        />
      </PageContainer>
    );
  }

  const aiConfigured = isElevenLabsConfigured();
  const canListen = viewer.permissions.includes("monitor.listen");

  return (
    <PageContainer>
      <PageHeader
        title="Live Monitor"
        description="Watch every call in real time — AI and human. Listen in, oversee the transcript, take over, or end and categorize it from one place."
      />

      {/* AI agent calls — the primary live view */}
      <AiLiveMonitor
        configured={aiConfigured}
        initialCall={call ?? null}
        canListen={canListen}
      />

      {/* Human rep calls — appears only when a manual call is live */}
      <HumanLiveMonitor canListen={canListen} />
    </PageContainer>
  );
}
