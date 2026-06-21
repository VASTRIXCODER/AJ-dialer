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
  const [user, superadmin] = await Promise.all([getUser(), isSuperadmin()]);
  const account = user
    ? userDisplay(user)
    : superadmin
      ? { name: "Superadmin", email: "Overseer access", initials: "SA" }
      : null;

  // Superadmins are never locked out; everyone else respects the kill switch
  // and account suspension.
  if (!superadmin) {
    const settings = await getAppSettings();
    if (settings.maintenance) {
      return <MaintenanceScreen message={settings.message} />;
    }
    if (user && (await isAccountDisabled(user.id))) {
      return <MaintenanceScreen suspended />;
    }
  }

  return (
    <AppShell
      voiceConfigured={isVoiceConfigured()}
      aiConfigured={isAIConfigured()}
      account={account}
      superadmin={superadmin}
    >
      {children}
    </AppShell>
  );
}
