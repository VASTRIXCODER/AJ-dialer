import { redirect } from "next/navigation";
import { HubView } from "@/components/hub/hub-view";
import { isAIConfigured } from "@/lib/ai/claude";
import {
  getMyMemberships,
  getMyPendingRequests,
  getViewer,
} from "@/lib/org/membership";
import { isSuperadmin } from "@/lib/superadmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your organizations" };

export default async function HubPage() {
  if (await isSuperadmin()) redirect("/console");

  const viewer = await getViewer();
  if (viewer.isDemo) redirect("/dashboard"); // demo always works inside an org
  if (!viewer.user) redirect("/login");

  const [memberships, pending] = await Promise.all([
    getMyMemberships(viewer.user.id),
    getMyPendingRequests(viewer.user.id),
  ]);

  return (
    <HubView
      name={viewer.displayName}
      aiConfigured={isAIConfigured()}
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
