import { NextResponse } from "next/server";
import { ANALYSIS_PROMPT_VERSION } from "@/lib/ai/schemas";
import {
  getActiveArtifacts,
  insertArtifacts,
  supersedeArtifact,
} from "@/lib/db/call-artifacts";
import { getScope } from "@/lib/db/scope";
import { rateLimit } from "@/lib/rate-limit";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Supervisor edit of a call's summary (F1 §6). The edit is an OVERRIDE, not a
 * mutation: the AI's summary artifact is superseded by a source='human' row
 * (so provenance flips from "AI-generated" to "Edited by <name>", and no
 * re-analysis can ever bury the correction), and call_records.summary is
 * updated so the archive searches the human's words.
 */
export async function PATCH(req: Request) {
  const scope = await getScope();
  if (!scope?.orgId) {
    return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  }
  if (!scope.supervisor) {
    return NextResponse.json(
      { ok: false, error: "Only supervisors can edit summaries." },
      { status: 403 },
    );
  }
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Editing needs a connected database." },
      { status: 503 },
    );
  }
  const rl = rateLimit(`summary-edit:${scope.userId}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const body = (await req.json().catch(() => ({}))) as {
    callRecordId?: string;
    text?: string;
  };
  const callRecordId = typeof body.callRecordId === "string" ? body.callRecordId : "";
  const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
  if (!UUID.test(callRecordId) || !text) {
    return NextResponse.json(
      { ok: false, error: "A call and a non-empty summary are required." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  // Org fence: a supervisor edits their own org's calls only.
  const { data: rec } = await admin
    .from("call_records")
    .select("id, org_id, conversation_id")
    .eq("id", callRecordId)
    .maybeSingle();
  if (!rec || String(rec.org_id ?? "") !== scope.orgId) {
    return NextResponse.json({ ok: false, error: "Call not found." }, { status: 404 });
  }

  // Supersede the active summary artifact when one exists; a legacy call with
  // no artifact gets a fresh human-authored one, so provenance exists from the
  // first edit onward.
  const active = (await getActiveArtifacts(callRecordId)).find(
    (a) => a.kind === "summary",
  );
  if (active) {
    const keyPoints = Array.isArray(active.payload.keyPoints)
      ? active.payload.keyPoints
      : [];
    const result = await supersedeArtifact({
      artifactId: active.id,
      editorId: scope.userId,
      payload: { text, keyPoints, confidence: null },
    });
    if (!result.ok) {
      return NextResponse.json(
        { ok: false, error: result.error ?? "Couldn't save the edit." },
        { status: 409 },
      );
    }
  } else {
    await insertArtifacts([
      {
        orgId: scope.orgId,
        callRecordId,
        conversationId: (rec.conversation_id as string) ?? null,
        kind: "summary",
        payload: { text, keyPoints: [], confidence: null },
        confidence: null,
        promptVersion: ANALYSIS_PROMPT_VERSION,
        source: "human",
        createdBy: scope.userId,
      },
    ]);
  }

  const { error } = await admin
    .from("call_records")
    .update({ summary: text })
    .eq("id", callRecordId);
  if (error) {
    return NextResponse.json(
      { ok: false, error: "Couldn't update the record." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
