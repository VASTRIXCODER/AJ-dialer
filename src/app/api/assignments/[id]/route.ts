import { NextResponse } from "next/server";
import {
  getAssignment,
  getAssignmentEvents,
  updateAssignment,
  type AssignmentAction,
  type AssignmentUpdate,
} from "@/lib/db/assignments";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

const ACTIONS: readonly AssignmentAction[] = [
  "pause",
  "resume",
  "archive",
  "edit",
  "reclaim",
  "reassign",
];

/**
 * GET   — one assignment + its audit feed. Managers see any pack in the org;
 *         a rep only the packs assigned to them (getAssignment enforces it).
 * PATCH — lifecycle actions. assignments.manage only: a rep may PATCH nothing.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewer = await getViewer();
  const scope = await getScope();
  if (!scope?.orgId) {
    return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  }
  const canManage = viewer.permissions.includes("assignments.manage");
  const assignment = await getAssignment({ ...scope, supervisor: canManage || scope.supervisor }, id);
  if (!assignment) {
    return NextResponse.json({ error: "Assignment not found." }, { status: 404 });
  }
  const events = await getAssignmentEvents(id, scope.orgId);
  return NextResponse.json({ assignment, events });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer.permissions.includes("assignments.manage")) {
    return NextResponse.json(
      { ok: false, error: "You don't have permission to manage assignments." },
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
    action?: string;
    repId?: string;
    patch?: AssignmentUpdate["patch"];
  };
  const action = String(body.action ?? "");
  if (!(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
  }
  const result = await updateAssignment(
    { ...scope, supervisor: true },
    {
      packId: id,
      action: action as AssignmentAction,
      repId: body.repId ? String(body.repId) : undefined,
      patch: body.patch,
    },
  );
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
