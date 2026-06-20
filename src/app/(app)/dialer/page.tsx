import { Headphones, Users } from "lucide-react";
import { DialerClient } from "@/components/dialer/dialer-client";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { getDialQueue } from "@/lib/leads-source";
import { isVoiceConfigured } from "@/lib/twilio";

export const metadata = { title: "Power Dialer" };

export default async function DialerPage() {
  const queue = await getDialQueue();
  const voiceConfigured = isVoiceConfigured();
  const aiAgentConfigured = isElevenLabsConfigured();

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
        voiceConfigured={voiceConfigured}
        aiAgentConfigured={aiAgentConfigured}
      />
    </PageContainer>
  );
}
