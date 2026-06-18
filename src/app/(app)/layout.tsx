import { AppShell } from "@/components/layout/app-shell";
import { isVoiceConfigured } from "@/lib/twilio";

export default function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell voiceConfigured={isVoiceConfigured()}>{children}</AppShell>
  );
}
