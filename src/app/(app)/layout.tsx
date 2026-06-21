import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { MaintenanceScreen } from "@/components/layout/maintenance-screen";
import { isAIConfigured } from "@/lib/ai/claude";
import { getUser, userDisplay } from "@/lib/auth";
import { getAppSettings, isAccountDisabled } from "@/lib/db/app-control";
import { isSuperadmin } from "@/lib/superadmin";
import { isVoiceConfigured } from "@/lib/twilio";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Superadmins never enter the dialer — they live in the standalone console.
  if (await isSuperadmin()) redirect("/console");

  const user = await getUser();
  const account = user ? userDisplay(user) : null;

  // The global kill switch and per-account suspension gate every normal user.
  const settings = await getAppSettings();
  if (settings.maintenance) {
    return <MaintenanceScreen message={settings.message} />;
  }
  if (user && (await isAccountDisabled(user.id))) {
    return <MaintenanceScreen suspended />;
  }

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
