import { CampaignsView } from "@/components/campaigns/campaigns-view";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { getCampaigns } from "@/lib/db/pipeline";

export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const campaigns = await getCampaigns();

  return (
    <PageContainer>
      <PageHeader
        title="Campaigns"
        description="Organize outreach by utility provider, territory, and resolution play."
      />
      <CampaignsView campaigns={campaigns} />
    </PageContainer>
  );
}
