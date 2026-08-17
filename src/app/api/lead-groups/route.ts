import { NextResponse } from "next/server";
import {
  createLeadGroup,
  deleteLeadGroup,
  listLeadGroupsWithCounts,
  updateLeadGroup,
} from "@/lib/db/lead-groups";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

/**
 * The org's lead groups.
 *
 * Reading is open to any member — the dialer, the leads table and the upload
 * grid all need the list to render their filters. Writing is gated on
 * `leads.import`, which is exactly owner/admin/manager: the same people who can
 * put leads into the workspace decide how it's carved up. A rep can see the
 * buckets and dial them, but can't reorganize the team's book.
 */
export async function GET() {
  const viewer = await getViewer();
  const { groups, miscCount } = await listLeadGroupsWithCounts(viewer.org?.id ?? null);
  return NextResponse.json({
    groups,
    miscCount,
    canManage: viewer.permissions.includes("leads.import"),
  });
}

async function requireManager() {
  const viewer = await getViewer();
  if (!viewer.permissions.includes("leads.import")) {
    return { error: NextResponse.json({ error: "You don't have permission to manage lead groups." }, { status: 403 }) };
  }
  if (!viewer.org?.id) {
    return { error: NextResponse.json({ error: "No active workspace." }, { status: 400 }) };
  }
  return { orgId: viewer.org.id };
}

export async function POST(req: Request) {
  const gate = await requireManager();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => ({}))) as {
    label?: string;
    description?: string;
    kind?: "sorted" | "manual";
  };
  const { group, error } = await createLeadGroup(gate.orgId, {
    label: String(body.label ?? ""),
    description: String(body.description ?? ""),
    kind: body.kind === "manual" ? "manual" : "sorted",
  });
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ group });
}

export async function PATCH(req: Request) {
  const gate = await requireManager();
  if (gate.error) return gate.error;

  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    label?: string;
    description?: string;
    kind?: "sorted" | "manual";
    sortOrder?: number;
  };
  if (!body.id) return NextResponse.json({ error: "Which group?" }, { status: 400 });

  const { group, error } = await updateLeadGroup(gate.orgId, body.id, {
    ...(body.label !== undefined ? { label: String(body.label) } : {}),
    ...(body.description !== undefined ? { description: String(body.description) } : {}),
    ...(body.kind !== undefined ? { kind: body.kind } : {}),
    ...(body.sortOrder !== undefined ? { sortOrder: Number(body.sortOrder) } : {}),
  });
  if (error) return NextResponse.json({ error }, { status: 400 });
  return NextResponse.json({ group });
}

export async function DELETE(req: Request) {
  const gate = await requireManager();
  if (gate.error) return gate.error;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Which group?" }, { status: 400 });

  const { ok, movedToMisc, error } = await deleteLeadGroup(gate.orgId, id);
  if (!ok) return NextResponse.json({ error: error ?? "Couldn't delete that group." }, { status: 400 });
  return NextResponse.json({ ok, movedToMisc });
}
