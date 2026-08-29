import { NextResponse } from "next/server";
import { addToDnc } from "@/lib/db/dnc";
import { transitionOpportunityStage } from "@/lib/db/opportunities";
import { getScope } from "@/lib/db/scope";
import {
  canTransition,
  isOpportunityStage,
  type OpportunityStage,
  type StageActor,
} from "@/lib/opportunities/stage-machine";
import { getViewer } from "@/lib/org/membership";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// Move one opportunity between stages by hand — the CRM board's drag.
//
// The caller sends the stage it BELIEVES the record is in, and that belief is
// compare-and-set against the row. This is deliberate: a board that has been
// open for ten minutes may be showing a card that a disposition, a playbook or
// another supervisor has already moved. Reading the current stage server-side
// would happily apply "the drag" from wherever the record actually is — so a
// rep dragging from Working could silently close a record that had since been
// sold. A stale drag must fail and say so, which is what 409 is for.
// ─────────────────────────────────────────────────────────────────────────────

/** The stage machine's actor for a viewer — never inferred from permission. */
function actorFor(role: string | null): StageActor {
  return role === "owner" || role === "admin" || role === "manager" ? "manager" : "rep";
}

export async function POST(req: Request) {
  const viewer = await getViewer();
  if (!viewer.isDemo && !viewer.user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  // Re-checked here even though the board hides the affordance: a URL is typed,
  // and the sidebar filter is cosmetic.
  if (!viewer.permissions.includes("crm.pipeline.manage")) {
    return NextResponse.json(
      { error: "You don't have permission to move records between stages." },
      { status: 403 },
    );
  }
  const scope = await getScope();
  if (!scope?.orgId || !isAdminConfigured()) {
    return NextResponse.json({ error: "Workspace unavailable." }, { status: 400 });
  }
  const rl = rateLimit(`crm-stage:${scope.userId}`, 60, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    opportunityId?: string;
    from?: string;
    to?: string;
    reason?: string;
    allowRegress?: boolean;
  };
  const opportunityId = String(body.opportunityId ?? "");
  const from = String(body.from ?? "");
  const to = String(body.to ?? "");
  if (!opportunityId || !isOpportunityStage(from) || !isOpportunityStage(to)) {
    return NextResponse.json({ error: "Unknown stage." }, { status: 422 });
  }

  const actor = actorFor(viewer.role);
  const allowRegress = body.allowRegress === true;
  const verdict = canTransition(from, to, actor, { allowRegress });
  if (!verdict.ok) {
    // Say WHICH rule refused, in the operator's words. "Invalid transition"
    // teaches nobody anything.
    const why: Record<string, string> = {
      same_stage: "That record is already there.",
      unknown_stage: "Unknown stage.",
      regress_needs_human:
        "Moving a record backwards has to be deliberate — confirm the step back and try again.",
      sold_needs_trusted_actor:
        "Only a manager can mark a record won. Sold is never inferred.",
      leave_dnc_needs_human:
        "Only a manager can take a record off Do Not Contact.",
    };
    return NextResponse.json(
      { error: why[verdict.reason] ?? "That move isn't allowed.", reason: verdict.reason },
      { status: 422 },
    );
  }

  const admin = createAdminClient();
  // Org fence + the data the DNC branch needs, in one read.
  const { data: opp } = await admin
    .from("opportunities")
    .select("id, org_id, lead_id, stage")
    .eq("id", opportunityId)
    .eq("org_id", scope.orgId)
    .maybeSingle();
  if (!opp) {
    return NextResponse.json({ error: "Record not found." }, { status: 404 });
  }
  const current = String(opp.stage ?? "");
  if (current !== from) {
    return NextResponse.json(
      {
        error: "Someone moved this record while your board was open.",
        currentStage: current,
      },
      { status: 409 },
    );
  }

  const moved = await transitionOpportunityStage({
    opportunityId,
    orgId: scope.orgId,
    from,
    to,
    actor,
    actorId: scope.userId,
    reason: String(body.reason ?? "").slice(0, 200) || "crm_board",
    detail: { surface: "crm_board" },
    allowRegress,
  });
  if (!moved) {
    // The CAS lost between the read above and the write — same story as a
    // stale board, one race narrower.
    return NextResponse.json(
      { error: "Someone moved this record a moment ago. Refresh to see where it went." },
      { status: 409 },
    );
  }

  // Marking a record Do Not Contact and NOT writing the suppression list would
  // be the worst kind of half-measure: the board would look right while the
  // next import put the same person straight back into the dial queue. The
  // stage is the human's decision; the list is what enforces it everywhere.
  let suppressed = false;
  if (to === "dnc_suppressed" && opp.lead_id) {
    const { data: lead } = await admin
      .from("leads")
      .select("phone")
      .eq("id", String(opp.lead_id))
      .maybeSingle();
    const phone = String(lead?.phone ?? "");
    if (phone) {
      suppressed = await addToDnc({
        orgId: scope.orgId,
        phone,
        reason: "Marked Do Not Contact on the pipeline board",
        source: "rep_disposition",
        createdBy: scope.userId,
      });
    }
  }

  return NextResponse.json({ ok: true, stage: to as OpportunityStage, suppressed });
}
