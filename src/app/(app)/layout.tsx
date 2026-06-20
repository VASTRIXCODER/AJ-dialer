import { AppShell } from "@/components/layout/app-shell";
import { isAIConfigured } from "@/lib/ai/claude";
import { getUser, userDisplay } from "@/lib/auth";
import { isVoiceConfigured } from "@/lib/twilio";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUser();
  const account = user ? userDisplay(user) : null;

  return (
    <AppShell
      voiceConfigured={isVoiceConfigured()}
      aiConfigured={isAIConfigured()}
      account={account}
    >
      {children}
    </AppShell>
  );
}
