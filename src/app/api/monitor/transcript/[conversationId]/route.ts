import { NextResponse } from "next/server";
import { getAICall } from "@/lib/ai-call-store";
import { getAIConversation } from "@/lib/db/records";
import { fetchConversation, isElevenLabsConfigured } from "@/lib/elevenlabs";
import {
  type RelaySegment,
  diffNewTurns,
  maxTurnIndex,
} from "@/lib/monitor/transcript-relay";
import { getViewer } from "@/lib/org/membership";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { publishOrgEvent } from "@/lib/realtime/publish";
import { createAdminClient, isAdminConfigured } from "@/lib/supabase/admin";
import { count } from "@/lib/telemetry";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// The live-transcript RELAY: N supervisors watching one call share ONE
// ElevenLabs poll instead of N.
//
// How: segments are served from call_transcript_segments; a freshness gate on
// transcript_cursors (fetched_at within FRESH_MS) decides whether THIS request
// pays for the provider round-trip. The winner diffs the provider transcript
// past the cursor, UPSERTs the new turns (idempotent on the
// (conversation_id, turn_index) unique key), advances the cursor with a guarded
// update (only where fetched_at still equals what it read — a lost race means
// someone else already advanced it), and broadcasts each new segment on the org
// floor channel so every open pane hears it without polling at all.
// ─────────────────────────────────────────────────────────────────────────────

/** Serve stored segments without re-asking the provider within this window. */
const FRESH_MS = 2_500;

type Row = Record<string, unknown>;

function rowToSegment(r: Row): RelaySegment {
  return {
    turnIndex: Number(r.turn_index),
    role: String(r.role ?? "agent"),
    message: String(r.message ?? ""),
    secs: r.secs == null ? null : Number(r.secs),
    final: !r.interim,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId: raw } = await params;
  const conversationId = decodeURIComponent(raw);

  // Same audience as the conversation detail route: monitor + reports readers.
  const viewer = await getViewer();
  const allowed =
    viewer.permissions.includes("monitor.view") ||
    viewer.permissions.includes("reports.view");
  if (!allowed) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const orgId = viewer.org?.id ?? null;
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rl = rateLimit(
    `transcript-relay:${viewer.user?.id ?? clientIp(req)}`,
    60,
    60_000,
  );
  if (!rl.ok) {
    return NextResponse.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  // Org ownership — the exact gate /api/elevenlabs/conversation/[id] applies:
  // trust the in-memory store's recorded org when the call is resident here;
  // otherwise the RLS-scoped DB read vouches (null = other org or unknown —
  // fail closed rather than fall through to the unscoped provider read).
  const stored = getAICall(conversationId);
  let db = stored ? null : await getAIConversation(conversationId);
  if (stored) {
    if (stored.orgId !== orgId)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  } else if (!db) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const sinceRaw = Number(url.searchParams.get("since"));
  const since = Number.isInteger(sinceRaw) && sinceRaw >= -1 ? sinceRaw : -1;

  let segments: RelaySegment[] = [];
  let served = false;

  if (isAdminConfigured()) {
    try {
      const admin = createAdminClient();

      // ── Freshness gate (the shared-poll heart of the relay) ────────────────
      const { data: cursorRow } = await admin
        .from("transcript_cursors")
        .select("last_turn, fetched_at")
        .eq("conversation_id", conversationId)
        .maybeSingle();
      const lastTurn = cursorRow ? Number(cursorRow.last_turn) : -1;
      const fetchedAt = cursorRow ? String(cursorRow.fetched_at) : null;
      const fresh =
        fetchedAt != null && Date.now() - Date.parse(fetchedAt) < FRESH_MS;

      if (!fresh && isElevenLabsConfigured()) {
        const convo = await fetchConversation(conversationId);
        if (convo) {
          const freshSegs = diffNewTurns(convo.turns, lastTurn);
          if (freshSegs.length > 0) {
            // Idempotent on (conversation_id, turn_index) — a racing relay
            // instance inserting the same turns is a no-op, not an error.
            await admin.from("call_transcript_segments").upsert(
              freshSegs.map((s) => ({
                org_id: orgId,
                conversation_id: conversationId,
                turn_index: s.turnIndex,
                role: s.role,
                message: s.message,
                secs: s.secs,
                source: "elevenlabs",
                interim: false,
              })),
              { onConflict: "conversation_id,turn_index", ignoreDuplicates: true },
            );
            // Fan out — every open pane renders these without waiting for its
            // own poll tick. Dedupe on turnIndex makes double-delivery safe.
            for (const s of freshSegs) {
              publishOrgEvent(orgId, "transcript.segment", {
                conversationId,
                turnIndex: s.turnIndex,
                role: s.role,
                message: s.message,
                secs: s.secs,
                final: true,
              });
            }
            count("transcript.relay_segments", freshSegs.length, { orgId });
          }

          // Advance the cursor — guarded, so a lost race never rolls it back.
          const nextTurn = Math.max(lastTurn, maxTurnIndex(convo.turns));
          if (cursorRow) {
            await admin
              .from("transcript_cursors")
              .update({ last_turn: nextTurn, fetched_at: new Date().toISOString() })
              .eq("conversation_id", conversationId)
              .eq("fetched_at", fetchedAt as string);
          } else {
            await admin
              .from("transcript_cursors")
              .upsert(
                { conversation_id: conversationId, last_turn: nextTurn },
                { onConflict: "conversation_id", ignoreDuplicates: true },
              );
          }
        }
      }

      const { data: segRows, error } = await admin
        .from("call_transcript_segments")
        .select("turn_index, role, message, secs, interim")
        .eq("conversation_id", conversationId)
        .gt("turn_index", since)
        .order("turn_index", { ascending: true })
        .limit(500);
      if (!error) {
        segments = ((segRows ?? []) as Row[]).map(rowToSegment);
        served = true;
      }
    } catch {
      /* fall through to the transcript fallback below */
    }
  }

  // Fallback (demo / PART 36 not applied / provider-only): serve straight from
  // the persisted turn array, un-relayed — degraded, never broken.
  if (!served || segments.length === 0) {
    db = db ?? (await getAIConversation(conversationId));
    const turns = db?.transcript ?? [];
    if (turns.length > 0) {
      segments = diffNewTurns(turns, since);
    }
  }

  return NextResponse.json(
    {
      segments,
      lastTurn: segments.length
        ? segments[segments.length - 1].turnIndex
        : since,
      generatedAt: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
