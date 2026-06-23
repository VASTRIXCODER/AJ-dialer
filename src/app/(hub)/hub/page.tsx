import { redirect } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { MaintenanceScreen } from "@/components/layout/maintenance-screen";
import { isAIConfigured } from "@/lib/ai/claude";
import { isAccountDisabled } from "@/lib/db/app-control";
import {
  getMyMemberships,
  getMyPendingRequests,
  getViewer,
} from "@/lib/org/membership";
import { isSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your organizations" };

export default async function HubPage() {
  const viewer = await getViewer();
  if (viewer.isDemo) redirect("/dashboard"); // demo always works inside an org
  if (!viewer.user) redirect("/login");

  // Superadmins reach the console from a discreet entry — they're not forced
  // there, and they're exempt from suspension (can't be locked out).
  const superadmin = await isSuperadmin();
  if (!superadmin && (await isAccountDisabled(viewer.user.id))) {
    return <MaintenanceScreen suspended />;
  }

  const [memberships, pending] = await Promise.all([
    getMyMemberships(viewer.user.id),
    getMyPendingRequests(viewer.user.id),
  ]);

  return (
    <HubView
      name={viewer.displayName}
      aiConfigured={isAIConfigured()}
      superadmin={superadmin}
      memberships={memberships.map((m) => ({
        id: m.org.id,
        name: m.org.name,
        productName: m.org.productName,
        tagline: m.org.tagline,
        industry: m.org.industry,
        brandColor: m.org.brandColor,
        dialerTemplate: m.org.dialerTemplate,
        role: m.role,
      }))}
      pending={pending}
    />
  );
}
