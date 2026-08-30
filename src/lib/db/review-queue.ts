import "server-only";

import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import type { Scope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// The needs-review queue reads. Rows come from two writers:
//   • the analyzer (analyzeCall) — low_confidence / high_impact /
//     missing_transcript proposals the policy refused to auto-apply, and
//   • reps' wrap-up [Flag for review] button — rep_flagged.
//
// Scope mirrors every other pipeline read: supervisors see the org's queue,
// reps see rows on THEIR OWN calls (a rep adjudicating the AI's read of their
// own conversation is the point; other people's calls are not their business).
// Reads use the service role because the join to call_records is what
// establishes rep ownership — the filter below IS the authorization.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

export interface ReviewQueueRow {
  id: string;
  reason: string;
  proposedDisposition: string | null;
  confidence: number | null;
  status: "open" | "resolved" | "dismissed";
  createdAt: string;
  callRecordId: string | null;
  conversationId: string | null;
  leadId: string | null;
  leadName: string;
  phone: string;
  ownerId: string | null;
  channel: "ai" | "human";
  outcome: string | null;
  disposition: string | null;
  startedAt: string | null;
}

export interface ReviewQueuePage {
  rows: ReviewQueueRow[];
  /** True when the queue can't be read at all (no service role / demo). */
  unavailable: boolean;
}

const SELECT =
  "id, reason, proposed_disposition, confidence, status, created_at, call_record_id, " +
  "call_records (id, lead_id, lead_name, phone, owner_id, channel, outcome, disposition, started_at, conversation_id)";

function mapRow(r: Row): ReviewQueueRow {
  const rec = (r.call_records ?? null) as Row | null;
  return {
    id: String(r.id),
    reason: String(r.reason ?? ""),
    proposedDisposition: (r.proposed_disposition as string) ?? null,
    confidence: r.confidence == null ? null : Number(r.confidence),
    status:
      r.status === "resolved" || r.status === "dismissed" ? r.status : "open",
    createdAt: String(r.created_at ?? ""),
    callRecordId: (r.call_record_id as string) ?? null,
    conversationId: rec ? ((rec.conversation_id as string) ?? null) : null,
    leadId: rec ? ((rec.lead_id as string) ?? null) : null,
    leadName: rec ? String(rec.lead_name ?? "").trim() : "",
    phone: rec ? String(rec.phone ?? "") : "",
    ownerId: rec ? ((rec.owner_id as string) ?? null) : null,
    channel: rec?.channel === "ai" ? "ai" : "human",
    outcome: rec ? ((rec.outcome as string) ?? null) : null,
    disposition: rec ? ((rec.disposition as string) ?? null) : null,
    startedAt: rec ? ((rec.started_at as string) ?? null) : null,
  };
}

/** The OPEN review rows this actor may see, newest first. */
export async function getReviewQueue(scope: Scope | null): Promise<ReviewQueuePage> {
  if (!scope?.orgId || !isAdminConfigured()) return { rows: [], unavailable: true };
  try {
    const { data, error } = await createAdminClient()
      .from("call_review_queue")
      .select(SELECT)
      .eq("org_id", scope.orgId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(100);
    // `unavailable: false` on a failed read told /callbacks there was nothing
    // to adjudicate. An unadjudicated disposition is blocking a call record
    // right now, so "none" is the one answer that stops anybody looking.
    if (error) return { rows: [], unavailable: true };
    let rows = ((data ?? []) as unknown as Row[]).map(mapRow);
    // A rep sees only reviews on their own calls. A row with no call record
    // has no owner to grant through — supervisor-only by construction.
    if (!scope.supervisor) {
      rows = rows.filter((r) => r.ownerId && r.ownerId === scope.userId);
    }
    return { rows, unavailable: false };
  } catch {
    return { rows: [], unavailable: true };
  }
}

export interface ReviewRowForAction extends ReviewQueueRow {
  orgId: string | null;
}

/** One review row with the fields the PATCH route authorizes + acts on. */
export async function getReviewById(id: string): Promise<ReviewRowForAction | null> {
  if (!isAdminConfigured() || !id) return null;
  try {
    const { data } = await createAdminClient()
      .from("call_review_queue")
      .select(`org_id, ${SELECT}`)
      .eq("id", id)
      .maybeSingle();
    if (!data) return null;
    const row = data as unknown as Row;
    return { ...mapRow(row), orgId: (row.org_id as string) ?? null };
  } catch {
    return null;
  }
}
