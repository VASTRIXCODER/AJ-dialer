import { Radio } from "lucide-react";
import { MonitorShell } from "@/components/monitor/monitor-shell";
import { MonitorRealtimeStatus } from "@/components/monitor/realtime-status";
import { CallHistory } from "@/components/reports/call-history";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { getViewer } from "@/lib/org/membership";

export const metadata = { title: "Live Floor" };
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
          title="Live Floor"
          description="Oversee live calls between your reps and customers."
        />
        <EmptyState
          variant="page"
          icon={Radio}
          title="Live monitoring is for supervisors"
          description="Listening in on live calls is available to managers and admins. Ask an admin if you need access."
        />
      </PageContainer>
    );
  }

  const canListen = viewer.permissions.includes("monitor.listen");
  const canIntervene = viewer.permissions.includes("monitor.intervene");
  // Org-level gate: a manual-only workspace has no AI calls, so the legacy AI
  // panel is hidden under "Calls" and the floor simply never shows AI cards.
  const aiDialerEnabled = viewer.org?.settings.features.aiDialer !== false;
  const aiConfigured = isElevenLabsConfigured() && aiDialerEnabled;
  const orgId = viewer.org?.id ?? null;

  return (
    <PageContainer>
      <PageHeader
        title="Live Floor"
        description="Every seat and every call, in one live picture — who's dialing, who's connected, and who needs a listen. Click any card for the full context."
      >
        {/* Push-fed or polling? The pill says so honestly. */}
        <MonitorRealtimeStatus orgId={orgId} />
      </PageHeader>

      <MonitorShell
        orgId={orgId}
        canListen={canListen}
        canIntervene={canIntervene}
        aiConfigured={aiConfigured}
        initialCall={call ?? null}
        historySlot={
          <SectionCard
            title="Call history"
            description="Every completed call, newest first — click any for the full breakdown (recording, transcript & summary)"
            bodyClassName="p-0"
          >
            <CallHistory />
          </SectionCard>
        }
      />
    </PageContainer>
  );
}
