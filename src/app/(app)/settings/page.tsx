import { SettingsView } from "@/components/settings/settings-view";
import { PageContainer, PageHeader } from "@/components/shared/page-header";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your profile, appearance, and dialing preferences."
      />
      <SettingsView />
    </PageContainer>
  );
}
