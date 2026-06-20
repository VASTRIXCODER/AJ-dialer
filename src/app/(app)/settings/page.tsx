import { SettingsView } from "@/components/settings/settings-view";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { getUser, userDisplay } from "@/lib/auth";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await getUser();
  const account = user ? userDisplay(user) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Settings"
        description="Manage your profile, appearance, and dialing preferences."
      />
      <SettingsView account={account} />
    </PageContainer>
  );
}
