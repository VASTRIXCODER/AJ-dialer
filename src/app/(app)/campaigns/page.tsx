import { CampaignsView } from "@/components/campaigns/campaigns-view";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { getCampaigns } from "@/lib/db/pipeline";
import { resolveLeadFields, type CoreFieldOverrides } from "@/lib/leads/field-schema";
import { getViewer } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";

export const metadata = { title: "Campaigns" };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const [campaigns, viewer] = await Promise.all([getCampaigns(), getViewer()]);

  // The create form's targeting field is the utilityProvider CORE SLOT — its
  // label comes from the org's resolved schema (template relabels + admin
  // overrides), never the solar-era literal. Vocab audit: this page used to say
  // "utility provider … and resolution play" to every vertical.
  const providerLabel =
    resolveLeadFields(
      viewer.org?.settings.leadFields,
      (templateProfile(viewer.org?.dialerTemplate) as { fields?: CoreFieldOverrides }).fields,
    ).find((f) => f.key === "utilityProvider")?.label ?? "Provider";

  return (
    <PageContainer>
      <PageHeader
        title="Campaigns"
        description="Organize outreach into focused plays — audience, scripts, pacing, and goals."
      />
      <CampaignsView campaigns={campaigns} providerLabel={providerLabel} />
    </PageContainer>
  );
}
