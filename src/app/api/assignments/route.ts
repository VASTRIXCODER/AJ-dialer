import { NextResponse } from "next/server";
import {
  allocateAssignment,
  getMyAssignments,
  listAssignments,
  type AllocationPolicy,
  type AllocationSource,
} from "@/lib/db/assignments";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * GET  — the viewer's assignments. Holders of `assignments.manage` get the
 *        whole org's; everyone else gets only the packs assigned to them
 *        (listAssignments narrows by scope.supervisor; a rep granted the
 *        permission via override gets the supervisor view on purpose).
 * POST — allocate a new assignment (assignments.manage).
 */
export async function GET() {
  const viewer = await getViewer();
  const scope = await getScope();
  if (!scope) {
    // Demo mode has no session — return an empty, well-formed payload.
    return NextResponse.json({ assignments: [], canManage: viewer.permissions.includes("assignments.manage") });
  }
  const canManage = viewer.permissions.includes("assignments.manage");
  const assignments = canManage
    ? await listAssignments({ ...scope, supervisor: true })
    : await getMyAssignments(scope.userId, scope.orgId);
  return NextResponse.json({ assignments, canManage });
}

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("assignments.manage")) {
    return NextResponse.json(
      { ok: false, error: "You don't have permission to allocate assignments." },
      { status: 403 },
    );
  }
  const scope = await getScope();
  if (!scope?.orgId) {
    return NextResponse.json(
      { ok: false, error: "Join an organization first." },
      { status: 400 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as {
    repId?: string;
    count?: number;
    label?: string;
    policy?: AllocationPolicy;
    source?: AllocationSource;
  };
  const result = await allocateAssignment({
    orgId: scope.orgId,
    actorId: scope.userId,
    repId: String(body.repId ?? ""),
    count: Number(body.count ?? 0),
    label: String(body.label ?? ""),
    policy: body.policy,
    source: body.source,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
