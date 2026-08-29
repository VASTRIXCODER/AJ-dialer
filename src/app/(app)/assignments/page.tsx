import { AssignmentCenter } from "@/components/assignments/assignment-center";
import { MyAssignments } from "@/components/assignments/my-assignments";
import { PageContainer } from "@/components/shared/page-header";
import {
  getMyAssignments,
  listAssignments,
} from "@/lib/db/assignments";
import { getCampaigns } from "@/lib/db/pipeline";
import { getScope } from "@/lib/db/scope";
import { listSmartLists } from "@/lib/db/smart-lists";
import { resolveLeadFields, type CoreFieldOverrides } from "@/lib/leads/field-schema";
import { getViewer, listMembers } from "@/lib/org/membership";
import { templateProfile } from "@/lib/org/templates";

export const metadata = { title: "Assignments" };
export const dynamic = "force-dynamic";

/**
 * ONE route, two workspaces: holders of `assignments.manage` (manager+) get
 * the Assignment Center — allocate, track, and rebalance every pack of work;
 * everyone else gets My Assignments — the packs handed to THEM, laned by
 * urgency, each one a click from the dialer. The role switch is server-side so
 * a rep never even downloads the management surface.
 */
export default async function AssignmentsPage() {
  const viewer = await getViewer();
  const canManage = viewer.permissions.includes("assignments.manage");
  // Demo mode has no session — same fallback the leads page uses (the demo
  // paths ignore the ids anyway, and the demo viewer is an owner).
  const scope = (await getScope()) ?? { userId: "demo", orgId: null, supervisor: true };

  if (!canManage) {
    const assignments = await getMyAssignments(scope.userId, scope.orgId);
    return (
      <PageContainer>
        <MyAssignments assignments={assignments} />
      </PageContainer>
    );
  }

  const [assignments, campaigns, smartLists] = await Promise.all([
    listAssignments({ ...scope, supervisor: true }),
    getCampaigns(),
    listSmartLists(scope),
  ]);
  // ACTIVE members only — every allocation path hard-fails on a pending
  // member, so offering one in the rep dropdown would be a trap (the same
  // lesson the leads page learned).
  const members = viewer.org
    ? (await listMembers(viewer.org.id))
        .filter((m) => m.status === "active")
        .map((m) => ({ id: m.userId, name: m.name }))
    : [];
  // The org's resolved field schema drives the wizard's custom-filter builder,
  // exactly as it does on /leads — field LABELS come from here, never literals.
  const fields = resolveLeadFields(
    viewer.org?.settings.leadFields,
    (templateProfile(viewer.org?.dialerTemplate) as { fields?: CoreFieldOverrides })
      .fields,
  );

  return (
    <PageContainer>
      <AssignmentCenter
        initialAssignments={assignments}
        members={members}
        campaigns={campaigns
          .filter((c) => c.status !== "completed")
          .map((c) => ({ id: c.id, name: c.name }))}
        smartLists={smartLists.map((l) => ({ id: l.id, name: l.name }))}
        fields={fields}
      />
    </PageContainer>
  );
}
