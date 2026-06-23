import { SettingsView } from "@/components/settings/settings-view";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { getViewer } from "@/lib/org/membership";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const viewer = await getViewer();

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your profile, access, appearance, and dialing preferences."
      />
      <SettingsView
        account={{ name: viewer.displayName, email: viewer.email }}
        role={viewer.role}
        orgName={viewer.org?.name ?? null}
        productName={viewer.org?.productName || null}
        membershipStatus={viewer.membershipStatus}
        permissions={viewer.permissions}
      />
    </PageContainer>
  );
}
