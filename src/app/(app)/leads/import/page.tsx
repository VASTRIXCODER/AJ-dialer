import { ShieldOff } from "lucide-react";
import { ImportStudio } from "@/components/leads/import-studio/import-studio";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { listLeadGroupsWithCounts } from "@/lib/db/lead-groups";
import { getCampaigns } from "@/lib/db/pipeline";
import { resolveLeadFields, type CoreFieldOverrides } from "@/lib/leads/field-schema";
import { getViewer } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";
import { orgVocabulary } from "@/lib/org/vocabulary";

export const metadata = { title: "Import Studio" };
export const dynamic = "force-dynamic";

/**
 * The Import Studio — the guided replacement for the silent drop-import.
 * Server side gathers what the wizard needs to speak the org's language: the
 * resolved field schema (mapping targets use ITS labels), the org's groups,
 * and its campaigns. The wizard itself is a client step machine.
 */
export default async function ImportStudioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [viewer, sp] = await Promise.all([getViewer(), searchParams]);
  const vocab = orgVocabulary(viewer.org);

  // Permission state — reps land here from a stale link, not from the tiles.
  if (!viewer.permissions.includes("leads.import")) {
    return (
      <PageContainer>
        <PageHeader title="Import Studio" />
        <EmptyState
          icon={ShieldOff}
          title="Imports need a manager"
          description={`Ask a manager or admin to import ${vocab.leadNounPlural} — your account doesn't have the import permission.`}
        />
      </PageContainer>
    );
  }

  const [{ groups }, campaigns] = await Promise.all([
    listLeadGroupsWithCounts(viewer.org?.id ?? null),
    getCampaigns(),
  ]);

  const fields = resolveLeadFields(
    viewer.org?.settings.leadFields,
    (templateProfile(viewer.org?.dialerTemplate) as { fields?: CoreFieldOverrides })
      .fields,
  );

  const rawGroup = sp.group;
  const initialGroup =
    typeof rawGroup === "string" && rawGroup ? rawGroup : Array.isArray(rawGroup) ? (rawGroup[0] ?? null) : null;

  return (
    <PageContainer>
      <PageHeader
        title="Import Studio"
        description={`Bring in a book of ${vocab.leadNounPlural} — every column reviewed, every row accounted for, and the whole import rollbackable.`}
      />
      <ImportStudio
        fields={fields}
        groups={groups.map((g) => ({ key: g.key, label: g.label }))}
        campaigns={campaigns
          .filter((c) => c.status !== "completed")
          .map((c) => ({ id: c.id, name: c.name }))}
        initialGroup={initialGroup}
      />
    </PageContainer>
  );
}
