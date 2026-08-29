import { KanbanSquare, Lock } from "lucide-react";
import { Suspense } from "react";
import { CrmWorkspace, type AudienceCard } from "@/components/crm/crm-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { PageContainer, PageHeader } from "@/components/shared/page-header";
import { getCrmBoard, getCrmQueue } from "@/lib/db/crm";
import { getScope } from "@/lib/db/scope";
import { listSmartLists, validateSmartListFilter } from "@/lib/db/smart-lists";
import { resolveLeadFields, type CoreFieldOverrides } from "@/lib/leads/field-schema";
import { encodeFilterParam } from "@/lib/leads/filter-spec";
import { getViewer, listMembers } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";
import { orgVocabulary } from "@/lib/org/vocabulary";

export const metadata = { title: "CRM" };
export const dynamic = "force-dynamic";

/**
 * The CRM workspace: where the opportunity layer finally becomes visible.
 *
 * Everything here already existed and had no surface. Opportunities have been
 * written for every lead since PART 37 and were rendered nowhere; the shared
 * work queue had an atomic claim function with no caller; audiences were
 * filters you could only reach as chips on another page.
 *
 * Three views, one job each:
 *   Pipeline — where every open record stands, and what has stopped moving.
 *   Queue    — what is unowned and claimable right now.
 *   Audiences— which populations exist, and how healthy they are.
 *
 * Deliberately NOT here: a second lead table (/leads owns that), a second
 * filter builder, a personal task list (/today owns that), or KPI tiles
 * (/command and /reports own measurement). If a "Leads" tab ever appears in
 * this route, delete it.
 */
export default async function CrmPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; owner?: string }>;
}) {
  const { owner } = await searchParams;
  const viewer = await getViewer();
  const vocab = orgVocabulary(viewer.org);

  // The nav hides this, but a page must never trust the nav — a URL is typed,
  // bookmarked and shared. Every write route re-checks independently.
  if (!viewer.permissions.includes("crm.view")) {
    return (
      <PageContainer>
        <PageHeader title="CRM" description="Pipeline, shared queue and audiences." />
        <EmptyState
          icon={Lock}
          title="You don't have access to the CRM"
          description="Your role doesn't include the CRM workspace. An owner or admin can grant it in Admin → Members."
        />
      </PageContainer>
    );
  }

  const scope = await getScope();
  if (!scope?.orgId) {
    return (
      <PageContainer>
        <PageHeader title="CRM" description="Pipeline, shared queue and audiences." />
        <EmptyState
          icon={KanbanSquare}
          title="No workspace yet"
          description={`Join or create an organization to start tracking ${vocab.leadNounPlural} through a pipeline.`}
          action={{ label: "Open the hub", href: "/hub" }}
        />
      </PageContainer>
    );
  }

  // The owner picker is a supervisor's tool. `getCrmBoard` ignores the param
  // for a rep regardless — a URL can never widen a rep past their own book.
  const [board, queue, smartLists, members] = await Promise.all([
    getCrmBoard(scope, { ownerId: owner ?? null }),
    getCrmQueue(scope),
    listSmartLists(scope),
    scope.supervisor && viewer.org?.id ? listMembers(viewer.org.id) : Promise.resolve([]),
  ]);

  const fields = resolveLeadFields(
    viewer.org?.settings.leadFields,
    (templateProfile(viewer.org?.dialerTemplate) as { fields?: CoreFieldOverrides }).fields,
  );

  // Audiences carry NO row counts. Counting a saved filter is a full scan per
  // list, which is exactly why the smart-list module refuses to do it on read —
  // a page that quietly ran ten of them would be the slowest screen in the
  // product. What an audience owes you here is what it selects and whether it
  // still works; the count is one click away in Leads.
  const audiences: AudienceCard[] = smartLists.map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    tone: l.tone,
    favorite: l.favorite,
    shared: l.shared,
    conditions: countConditions(l.filter),
    warnings: validateSmartListFilter(l.filter, fields),
    href: buildLeadsHref(encodeFilterParam(l.filter)),
  }));

  return (
    <PageContainer>
      <PageHeader
        title="CRM"
        description={`Where every ${vocab.leadNoun} stands, what nobody has picked up, and which lists you can work.`}
      />
      {/* useSearchParams (the ?view= deep link) needs a Suspense boundary. */}
      <Suspense fallback={null}>
        <CrmWorkspace
          board={board}
          queue={queue}
          audiences={audiences}
          canManagePipeline={viewer.permissions.includes("crm.pipeline.manage")}
          canClaim={viewer.permissions.includes("work.claim")}
          canOpenLeads={viewer.org?.settings.features.leads !== false}
          owners={members
            .filter((m) => m.status === "active")
            .map((m) => ({ id: m.userId, name: m.name || m.email || "Rep" }))
            .sort((a, b) => a.name.localeCompare(b.name))}
          appointmentNoun={vocab.appointmentNoun}
          leadNoun={vocab.leadNoun}
          leadNounPlural={vocab.leadNounPlural}
        />
      </Suspense>
    </PageContainer>
  );
}

/** "" when the filter can't be encoded — the surface then offers no dead link. */
function buildLeadsHref(param: string): string | null {
  return param ? `/leads?f=${param}` : null;
}

/** How many conditions the audience actually tests — depth-first, groups too. */
function countConditions(group: unknown): number {
  const g = group as { all?: unknown[]; any?: unknown[] } | null;
  const list = g?.all ?? g?.any;
  if (!Array.isArray(list)) return 0;
  return list.reduce<number>((total, item) => {
    const it = item as { all?: unknown; any?: unknown };
    return total + (it && (it.all || it.any) ? countConditions(it) : 1);
  }, 0);
}
