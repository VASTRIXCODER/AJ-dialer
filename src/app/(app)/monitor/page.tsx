import { Radio } from "lucide-react";
import { AiLiveMonitor } from "@/components/monitor/ai-live-monitor";
import { HumanLiveMonitor } from "@/components/monitor/human-live-monitor";
import { CallHistory } from "@/components/reports/call-history";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
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

  const canListen = viewer.permissions.includes("monitor.listen");
  const canIntervene = viewer.permissions.includes("monitor.intervene");
  // Org-level gate: a manual-only workspace (e.g. Donny) has no AI calls, so the
  // entire AI live view — "Live AI calls" + "Recent AI calls" — is hidden, and
  // the human monitor becomes the primary (always-on) view.
  const aiDialerEnabled = viewer.org?.settings.features.aiDialer !== false;
  const aiConfigured = isElevenLabsConfigured() && aiDialerEnabled;

  return (
    <PageContainer>
      <PageHeader
        title="Live Monitor"
        description={
          aiDialerEnabled
            ? "Watch every call in real time — AI and human. Listen in, oversee the transcript, take over, or end and categorize it from one place."
            : "Watch your reps' calls in real time. Listen in on a live call; completed calls with recordings and summaries live in Reports."
        }
      />

      {/* AI agent calls — only when the org actually uses the AI dialer */}
      {aiConfigured && (
        <AiLiveMonitor
          configured={aiConfigured}
          initialCall={call ?? null}
          canListen={canListen}
          canIntervene={canIntervene}
        />
      )}

      {/* Human rep calls — primary (always shown) when there's no AI view */}
      <HumanLiveMonitor canListen={canListen} primary={!aiConfigured} />

      {/* Full call history — every call ever logged (not just the live/recent
          panels above), paginated, each with its recording + transcript. Same
          org-scoped source the Reports tab uses, so the two agree. */}
      <SectionCard
        title="Call history"
        description="Every completed call, newest first — click any for the full breakdown (recording, transcript & summary)"
        bodyClassName="p-0"
      >
        <CallHistory />
      </SectionCard>
    </PageContainer>
  );
}
