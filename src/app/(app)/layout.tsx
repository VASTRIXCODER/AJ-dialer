import { AppShell } from "@/components/layout/app-shell";
import { isAIConfigured } from "@/lib/ai/claude";
import { isVoiceConfigured } from "@/lib/twilio";

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell
      voiceConfigured={isVoiceConfigured()}
      aiConfigured={isAIConfigured()}
    >
      {children}
    </AppShell>
  );
}
