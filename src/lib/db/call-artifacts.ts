import "server-only";

import { aiMaySupersede } from "../ai/disposition-policy";
import type { ArtifactKind } from "../ai/schemas";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";

// ─────────────────────────────────────────────────────────────────────────────
// The call-artifact store: structured AI extractions with provenance and an
// append-only supersede chain.
//
// Rows are never updated in place (beyond the status flip) and never deleted:
// a correction INSERTS a new row pointing at the one it replaces and flips the
// old row to 'superseded'. That preserves the full history — who said what,
// when, from which model and prompt version — which is exactly the audit trail
// a "the AI wrote this / a person corrected it" product needs.
//
// The one hard rule (enforced here AND at the analyzer): an AI writer may
// NEVER supersede a source='human' row. See aiMaySupersede().
//
// All writes go through the service-role client — call_artifacts has an
// org-member READ policy only; application code (analyzeCall, the summary-edit
// route) authorizes writers before calling in.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

export interface CallArtifactRow {
  id: string;
  orgId: string | null;
  callRecordId: string | null;
  conversationId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  confidence: number | null;
  evidence: number[];
  model: string | null;
  promptVersion: string | null;
  source: "ai" | "human";
  status: "active" | "superseded";
  supersedes: string | null;
  createdBy: string | null;
  createdAt: string;
}

function mapRow(r: Row): CallArtifactRow {
  return {
    id: String(r.id),
    orgId: (r.org_id as string) ?? null,
    callRecordId: (r.call_record_id as string) ?? null,
    conversationId: (r.conversation_id as string) ?? null,
    kind: String(r.kind ?? ""),
    payload:
      r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)
        ? (r.payload as Record<string, unknown>)
        : {},
    confidence: r.confidence == null ? null : Number(r.confidence),
    evidence: Array.isArray(r.evidence) ? r.evidence.map(Number).filter(Number.isInteger) : [],
    model: (r.model as string) ?? null,
    promptVersion: (r.prompt_version as string) ?? null,
    source: r.source === "human" ? "human" : "ai",
    status: r.status === "superseded" ? "superseded" : "active",
    supersedes: (r.supersedes as string) ?? null,
    createdBy: (r.created_by as string) ?? null,
    createdAt: String(r.created_at ?? ""),
  };
}

/** Every ACTIVE artifact on a call record (one per kind, by construction). */
export async function getActiveArtifacts(
  callRecordId: string,
): Promise<CallArtifactRow[]> {
  if (!isAdminConfigured() || !callRecordId) return [];
  try {
    const { data } = await createAdminClient()
      .from("call_artifacts")
      .select("*")
      .eq("call_record_id", callRecordId)
      .eq("status", "active")
      .order("created_at", { ascending: false });
    return ((data ?? []) as Row[]).map(mapRow);
  } catch {
    return [];
  }
}

export interface NewArtifact {
  orgId: string | null;
  callRecordId: string;
  conversationId?: string | null;
  kind: ArtifactKind | string;
  payload: Record<string, unknown>;
  confidence?: number | null;
  evidence?: number[];
  model?: string | null;
  promptVersion?: string | null;
  source: "ai" | "human";
  supersedes?: string | null;
  createdBy?: string | null;
}

/** Insert artifact rows (already-authorized caller). Best-effort, never throws. */
export async function insertArtifacts(rows: NewArtifact[]): Promise<boolean> {
  if (!isAdminConfigured() || rows.length === 0) return false;
  try {
    const { error } = await createAdminClient().from("call_artifacts").insert(
      rows.map((r) => ({
        org_id: r.orgId,
        call_record_id: r.callRecordId,
        conversation_id: r.conversationId ?? null,
        kind: r.kind,
        payload: r.payload,
        confidence: r.confidence ?? null,
        evidence: r.evidence ?? [],
        model: r.model ?? null,
        prompt_version: r.promptVersion ?? null,
        source: r.source,
        status: "active",
        supersedes: r.supersedes ?? null,
        created_by: r.createdBy ?? null,
      })),
    );
    return !error;
  } catch {
    return false;
  }
}

/**
 * A HUMAN correction of an artifact: inserts a source='human' row carrying the
 * editor's payload, chained to the row it replaces, and flips the old row to
 * 'superseded'. Only ACTIVE rows can be superseded — replaying a stale edit
 * against an already-replaced row is refused, not silently forked.
 */
export async function supersedeArtifact(input: {
  artifactId: string;
  editorId: string;
  payload: Record<string, unknown>;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!isAdminConfigured()) {
    return { ok: false, error: "Editing needs a connected database." };
  }
  try {
    const admin = createAdminClient();
    const { data: oldRow } = await admin
      .from("call_artifacts")
      .select("*")
      .eq("id", input.artifactId)
      .maybeSingle();
    if (!oldRow) return { ok: false, error: "That artifact no longer exists." };
    const old = mapRow(oldRow as Row);
    if (old.status !== "active") {
      return { ok: false, error: "That artifact was already replaced by a newer edit." };
    }

    const { data: inserted, error: insErr } = await admin
      .from("call_artifacts")
      .insert({
        org_id: old.orgId,
        call_record_id: old.callRecordId,
        conversation_id: old.conversationId,
        kind: old.kind,
        payload: input.payload,
        // Human-authored rows carry no model confidence — a person's words are
        // not a probability.
        confidence: null,
        evidence: [],
        model: null,
        prompt_version: old.promptVersion,
        source: "human",
        status: "active",
        supersedes: old.id,
        created_by: input.editorId,
      })
      .select("id")
      .maybeSingle();
    if (insErr || !inserted?.id) {
      return { ok: false, error: "Couldn't save the edit." };
    }

    await admin
      .from("call_artifacts")
      .update({ status: "superseded" })
      .eq("id", old.id);

    return { ok: true, id: String(inserted.id) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed." };
  }
}

/**
 * Which kinds the AI is FORBIDDEN to (re)write on this record: any kind that
 * currently has an active human row. The analyzer checks this BEFORE writing —
 * a re-analysis must never bury a person's correction under fresh model output.
 */
export async function humanAuthoredKinds(callRecordId: string): Promise<Set<string>> {
  const active = await getActiveArtifacts(callRecordId);
  const blocked = new Set<string>();
  for (const row of active) {
    if (!aiMaySupersede(row.source)) blocked.add(row.kind);
  }
  return blocked;
}

/**
 * Supersede this record's active AI rows of the given kinds (a re-analysis
 * replacing its own earlier output — allowed; human rows never appear here
 * because the caller excluded their kinds via humanAuthoredKinds()).
 * Returns kind → superseded row id so the new rows can chain to them.
 */
export async function supersedeAIArtifacts(
  callRecordId: string,
  kinds: string[],
): Promise<Map<string, string>> {
  const chained = new Map<string, string>();
  if (!isAdminConfigured() || kinds.length === 0) return chained;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("call_artifacts")
      .select("id, kind, source")
      .eq("call_record_id", callRecordId)
      .eq("status", "active")
      .eq("source", "ai")
      .in("kind", kinds);
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return chained;
    await admin
      .from("call_artifacts")
      .update({ status: "superseded" })
      .in(
        "id",
        rows.map((r) => String(r.id)),
      );
    for (const r of rows) chained.set(String(r.kind), String(r.id));
    return chained;
  } catch {
    return chained;
  }
}
