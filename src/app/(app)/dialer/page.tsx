import { Headphones, Users } from "lucide-react";
import { DialerClient } from "@/components/dialer/dialer-client";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getCampaigns } from "@/lib/db/pipeline";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { getDialQueue } from "@/lib/leads-source";
import { isVoiceConfigured } from "@/lib/twilio";

export const metadata = { title: "Power Dialer" };
export const dynamic = "force-dynamic";

export default async function DialerPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const [{ campaign }, queue, campaigns] = await Promise.all([
    searchParams,
    getDialQueue(),
    getCampaigns(),
  ]);
  const voiceConfigured = isVoiceConfigured();
  const aiAgentConfigured = isElevenLabsConfigured();
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
            Manual dial ready
          </Badge>
        )}
      </PageHeader>

      <DialerClient
        queue={queue}
        campaigns={dialCampaigns}
        initialCampaign={campaign ?? ""}
        voiceConfigured={voiceConfigured}
        aiAgentConfigured={aiAgentConfigured}
      />
    </PageContainer>
  );
}
