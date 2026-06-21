import { redirect } from "next/navigation";
import { AppManagement } from "@/components/admin/app-management";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { isSuperadmin } from "@/lib/superadmin";

export const metadata = { title: "App Management" };
export const dynamic = "force-dynamic";

export default async function AppManagementPage() {
  if (!(await isSuperadmin())) redirect("/login");

  return (
    <PageContainer>
      <PageHeader
        title="App Management"
        description="The superadmin overseer — manage every account and the app itself."
      />
      <AppManagement />
    </PageContainer>
  );
}
