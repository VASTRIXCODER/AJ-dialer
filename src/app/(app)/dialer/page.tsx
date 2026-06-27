import { Headphones, Users } from "lucide-react";
import { DialerClient } from "@/components/dialer/dialer-client";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getCampaigns } from "@/lib/db/pipeline";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { getDialQueue } from "@/lib/leads-source";
import { getViewer } from "@/lib/org/membership";
import { DEFAULT_FEATURES, resolveDialerAccess } from "@/lib/org/settings";
import { isVoiceConfigured } from "@/lib/twilio";

export const metadata = { title: "Power Dialer" };
export const dynamic = "force-dynamic";

export default async function DialerPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const [{ campaign }, queue, campaigns, viewer] = await Promise.all([
    searchParams,
    getDialQueue(),
    getCampaigns(),
    getViewer(),
  ]);
  const voiceConfigured = isVoiceConfigured();
  const aiAgentConfigured = isElevenLabsConfigured();
  // Resolve dialer access from org features + the viewer's role. Manual off ⇒
  // AI-only workspace; AI off (or rep without dialer.ai) ⇒ AI shows locked.
  const { manualEnabled, aiEnabled, aiLockReason } = resolveDialerAccess(
    viewer.org?.settings.features ?? DEFAULT_FEATURES,
    viewer.permissions.includes("dialer.ai"),
  );
  const dialCampaigns = campaigns
    .filter((c) => c.status !== "completed")
    .map((c) => ({ id: c.id, name: c.name }));

  return (
    <PageContainer>
      <PageHeader
        title="Power Dialer"
        description="Browser-based dialing with live solar qualification. No desk phone required."
      >
        {queue.length > 0 ? (
          <Badge tone="accent" className="gap-1.5">
            <Users className="h-3.5 w-3.5" />
            {queue.length} in queue
          </Badge>
        ) : (
          <Badge tone="neutral" className="gap-1.5">
            <Headphones className="h-3.5 w-3.5" />
            {manualEnabled ? "Manual dial ready" : "AI agent ready"}
          </Badge>
        )}
      </PageHeader>

      <DialerClient
        queue={queue}
        campaigns={dialCampaigns}
        initialCampaign={campaign ?? ""}
        voiceConfigured={voiceConfigured}
        aiAgentConfigured={aiAgentConfigured}
        manualEnabled={manualEnabled}
        aiEnabled={aiEnabled}
        aiLockReason={aiLockReason}
      />
    </PageContainer>
  );
}
