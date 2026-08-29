import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CampaignBuilder } from "@/components/campaigns/campaign-builder";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { getCampaigns } from "@/lib/db/pipeline";
import { getScope } from "@/lib/db/scope";
import { listSmartLists } from "@/lib/db/smart-lists";
import { resolveDispositionDefs } from "@/lib/dispositions/defs";
import { resolveLeadFields, type CoreFieldOverrides } from "@/lib/leads/field-schema";
import { getViewer, listMembers } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";
import { orgVocabulary } from "@/lib/org/vocabulary";
import { resolveLeadStatusConfig } from "@/lib/status";

export const metadata = { title: "Edit campaign" };
export const dynamic = "force-dynamic";

/**
 * Campaign Builder v2 — the ONE editing surface for a campaign (it retired the
 * old edit dialog). The server resolves everything workspace-specific here —
 * the org's field labels, caller-ID pool, disposition set, smart lists, and
 * member list — so the client component never guesses at vocabulary or offers
 * a choice the workspace doesn't have.
 */
export default async function CampaignEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const viewer = await getViewer();
  const scope = (await getScope()) ?? { userId: "demo", orgId: null, supervisor: true };
  const [campaigns, smartLists, members] = await Promise.all([
    getCampaigns(),
    listSmartLists(scope),
    viewer.org
      ? listMembers(viewer.org.id).then((ms) =>
          ms.filter((m) => m.status === "active").map((m) => ({ id: m.userId, name: m.name })),
        )
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);
  const c = campaigns.find((x) => x.id === id);
  if (!c) notFound();

  const vocab = orgVocabulary(viewer.org);
  const settings = viewer.org?.settings;
  // The org's resolved schema — the audience builder's field labels AND the
  // Identity card's provider-slot label both come from here, never a literal.
  const fields = resolveLeadFields(
    settings?.leadFields,
    (templateProfile(viewer.org?.dialerTemplate) as { fields?: CoreFieldOverrides }).fields,
  );
  const providerLabel =
    fields.find((f) => f.key === "utilityProvider")?.label ?? "Provider";
  const statusOptions = Object.entries(resolveLeadStatusConfig(vocab)).map(
    ([value, cfg]) => ({ value, label: cfg.label }),
  );
  // The `bills_fine` KEY never moves; its neutral default label yields to the
  // workspace's own wording exactly like the wrap-up panel does.
  const dispositionOptions = resolveDispositionDefs(settings?.dispositions).map((d) => ({
    key: d.key,
    label: d.key === "bills_fine" && d.label === "No need right now" ? vocab.noNeedLabel : d.label,
  }));

  return (
    <PageContainer>
      <Link
        href={`/campaigns/${c.id}`}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to campaign
      </Link>
      <div className="flex items-center gap-3">
        <span className="h-10 w-2 rounded-full" style={{ background: c.color }} />
        <PageHeader
          title={`Edit ${c.name}`}
          description="Each section saves on its own — tune one thing without touching the rest."
        >
          {c.archivedAt && <Badge tone="warning">Archived</Badge>}
        </PageHeader>
      </div>
      <CampaignBuilder
        campaign={{
          id: c.id,
          name: c.name,
          description: c.description,
          objective: c.objective,
          utilityProvider: c.utilityProvider,
          color: c.color,
          status: c.status,
          archivedAt: c.archivedAt,
          scriptA: c.scriptA,
          scriptB: c.scriptB,
          audience: c.audience,
          dialingPolicy: c.dialingPolicy,
          callerIds: c.callerIds,
          retryPolicy: c.retryPolicy,
          dispositionKeys: c.dispositionKeys,
          goals: c.goals,
        }}
        providerLabel={providerLabel}
        callerIdPool={settings?.dialing.callerIds ?? []}
        dispositionOptions={dispositionOptions}
        smartLists={smartLists.map((l) => ({ id: l.id, name: l.name }))}
        fields={fields}
        statusOptions={statusOptions}
        campaignOptions={campaigns
          .filter((x) => x.status !== "completed")
          .map((x) => ({ id: x.id, name: x.name }))}
        repOptions={members}
        orgLimits={{
          callsPerRun: settings?.automation.callsPerRun ?? 3,
          maxConcurrent: settings?.ai.maxConcurrentCalls ?? 10,
        }}
      />
    </PageContainer>
  );
}
