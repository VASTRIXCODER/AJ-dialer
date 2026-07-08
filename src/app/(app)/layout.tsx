import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { MaintenanceScreen } from "@/components/layout/maintenance-screen";
import { PaywallScreen } from "@/components/layout/paywall-screen";
import { isAIConfigured } from "@/lib/ai/claude";
import { getAppSettings, isAccountDisabled } from "@/lib/db/app-control";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { getViewer } from "@/lib/org/membership";
import { DEFAULT_FEATURES, resolveDialerAccess } from "@/lib/org/settings";
import { isSuperadmin } from "@/lib/superadmin";
import { isVoiceConfigured } from "@/lib/twilio";
import { initials } from "@/lib/utils";

export default async function AppGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();

  // Signed out (and not demo) → sign in. Signed in but no active org → the Hub.
  if (!viewer.isDemo && !viewer.user) redirect("/login");
  if (!viewer.isDemo && !viewer.org) redirect("/hub");

  // Superadmins are also normal users (hidden) — they use the app like anyone,
  // and reach the Control Center through a discreet entry. They're exempt from
  // the kill switch / suspension so they can never lock themselves out.
  const superadmin = await isSuperadmin();

  if (viewer.user && !superadmin) {
    const settings = await getAppSettings();
    if (settings.maintenance) {
      return <MaintenanceScreen message={settings.message} />;
    }
    if (await isAccountDisabled(viewer.user.id)) {
      return <MaintenanceScreen suspended />;
    }
  }

  // Per-org paywall: if this workspace is gated and not yet activated by the
  // platform owner, lock it for everyone but the superadmin (who grants access).
  const billing = viewer.org?.settings.billing;
  if (!superadmin && billing?.paywall && !billing.active) {
    return (
      <PaywallScreen
        orgName={viewer.org?.name ?? "This workspace"}
        productName={viewer.org?.productName}
        billing={billing}
      />
    );
  }

  const account = {
    name: viewer.displayName,
    email: viewer.email,
    initials: initials(viewer.displayName) || "·",
  };

  // Config for the app-wide dialer engine (lives in AppShell so calls survive
  // navigation). Same resolution the dialer page uses for its access gates.
  const { manualEnabled, aiEnabled, aiLockReason } = resolveDialerAccess(
    viewer.org?.settings.features ?? DEFAULT_FEATURES,
    viewer.permissions.includes("dialer.ai"),
  );
  // Supervisors dial the whole org pool; reps dial only their own uploads
  // (mirrors getDialQueue's server-side scoping).
  const dialScope: "org" | "own" =
    viewer.role && ["owner", "admin", "manager"].includes(viewer.role) ? "org" : "own";
  const dialerConfig = {
    userId: viewer.user?.id,
    voiceConfigured: isVoiceConfigured(),
    aiAgentConfigured: isElevenLabsConfigured(),
    manualEnabled,
    aiEnabled,
    aiLockReason,
    dialScope,
  };

  return (
    <AppShell
      voiceConfigured={isVoiceConfigured()}
      aiConfigured={isAIConfigured()}
      account={account}
      permissions={viewer.permissions}
      features={viewer.org?.settings.features ?? null}
      orgName={viewer.org?.name ?? null}
      productName={viewer.org?.productName || null}
      brandColor={viewer.org?.brandColor || null}
      role={viewer.role}
      superadmin={superadmin}
      dialerConfig={dialerConfig}
    >
      {children}
    </AppShell>
  );
}
