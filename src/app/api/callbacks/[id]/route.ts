import { NextResponse } from "next/server";
import {
  reassignCallback,
  releaseCallback,
  rescheduleCallback,
  setCallbackPriority,
} from "@/lib/db/callbacks";
import { getScope } from "@/lib/db/scope";
import { getViewer } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH — callback workspace actions.
 *
 *  • reassign   — route it to another rep. Gated on `assignments.manage`
 *    (callbacks ARE distributed work, so the same permission that deals lead
 *    packs deals callbacks — checked here AND re-checked as supervisor scope
 *    in the db layer, same double-gate as the appointment routes).
 *  • priority   — flag/unflag (0–3). Same manager+ gate.
 *  • release    — let go of MY claim (backing out without dialing).
 *  • reschedule — new agreed time (or none). Owner/assignee/supervisor.
 *
 * Done / Cancel / Re-open stay on POST /api/pipeline (`action: "callback"`) —
 * the pre-existing status path this route deliberately doesn't duplicate.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!UUID.test(id)) {
    return NextResponse.json({ ok: false, error: "Invalid callback id." }, { status: 400 });
  }
  const scope = await getScope();
  if (!scope) {
    return NextResponse.json({ ok: false, error: "You must be signed in." }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    toUserId?: string;
    priority?: number;
    /** Floating wall-clock ("2026-06-23T18:00:00") or null = no time agreed. */
    dueAt?: string | null;
    reason?: string;
  };
  const action = String(body.action ?? "");

  if (action === "reassign" || action === "priority") {
    const viewer = await getViewer();
    if (!viewer.permissions.includes("assignments.manage")) {
      return NextResponse.json(
        { ok: false, error: "You don't have permission to manage the team's callbacks." },
        { status: 403 },
      );
    }
    const r =
      action === "reassign"
        ? await reassignCallback(id, String(body.toUserId ?? ""))
        : await setCallbackPriority(id, Number(body.priority ?? 0));
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (action === "release") {
    const r = await releaseCallback(id, scope.userId);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  if (action === "reschedule") {
    const dueAt =
      body.dueAt == null ? null : typeof body.dueAt === "string" ? body.dueAt : null;
    const r = await rescheduleCallback(
      id,
      dueAt,
      typeof body.reason === "string" ? body.reason : undefined,
    );
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  }

  return NextResponse.json({ ok: false, error: "Unknown action." }, { status: 400 });
}
