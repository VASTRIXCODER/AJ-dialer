import { NextResponse } from "next/server";
import { finalizeAIConversation, type Turn } from "@/lib/ai-call-finalize";
import {
  getAICall,
  updateAICall,
  type AICallState,
} from "@/lib/ai-call-store";
import { getAIConversation } from "@/lib/db/records";
import { getConversation, isElevenLabsConfigured } from "@/lib/elevenlabs";
import type { CallOutcome } from "@/lib/types";

export const dynamic = "force-dynamic";

type Sentiment = "positive" | "neutral" | "negative";
type TranscriptTurn = { role: string; message: string; secs: number | null };

interface DetailResponse {
  conversationId: string;
  leadId: string | null;
  leadName: string;
  phone: string;
  city: string;
  state: AICallState;
  sentiment: Sentiment;
  outcome: CallOutcome | null;
  summary: string;
  durationSec: number | null;
  startedAt: number | null;
  recordingAvailable: boolean;
  transcript: TranscriptTurn[];
  appointment: { when: string; notes: string } | null;
  configured: boolean;
}

function mapStatus(status: string | undefined): AICallState | null {
  switch ((status ?? "").toLowerCase()) {
    case "initiated":
    case "queued":
      return "initiated";
    case "in-progress":
    case "in_progress":
    case "ongoing":
      return "in_progress";
    case "processing":
    case "done":
    case "completed":
      return "completed";
    case "failed":
    case "error":
      return "failed";
    default:
      return null;
  }
}

const isTerminal = (s: string | undefined) => s === "completed" || s === "failed";
const asSentiment = (v: unknown): Sentiment =>
  v === "positive" || v === "negative" ? v : "neutral";

function parseTranscript(raw: unknown): TranscriptTurn[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((t) => {
      const turn = t as Record<string, unknown>;
      const secs = Number(turn.time_in_call_secs ?? turn.time_in_call ?? NaN);
      return {
        role: String(turn.role ?? turn.speaker ?? "agent"),
        message: String(turn.message ?? turn.text ?? "").trim(),
        secs: Number.isFinite(secs) ? secs : null,
      };
    })
    .filter((t) => t.message.length > 0);
}

/**
 * Live detail for a single AI conversation — powers the per-call mini dashboard.
 * Layers three sources, freshest first: the in-memory store (live state), the
 * ElevenLabs conversation API (transcript + status + recording), and Supabase
 * (durable, account-scoped fallback). If the call has reached a terminal state
 * and hasn't been finalized yet, it ends + categorizes it here too — so a
 * watched call is captured even if the post-call webhook never lands.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conversationId = decodeURIComponent(id);

  // ── Live ElevenLabs read (best-effort; a still-ringing call may 404) ────────
  let rawTurns: Turn[] = [];
  let transcript: TranscriptTurn[] = [];
  let liveState: AICallState | null = null;
  let liveDuration: number | null = null;
  let liveSummary = "";
  let liveSentiment: Sentiment | null = null;
  let hasAudio = false;
  let terminationReason = "";
  let liveStatusRaw = "";

  if (isElevenLabsConfigured()) {
    try {
      const convo = (await getConversation(conversationId)) as Record<
        string,
        unknown
      >;
      const data = (convo.data ?? convo) as Record<string, unknown>;
      rawTurns = Array.isArray(data.transcript) ? (data.transcript as Turn[]) : [];
      transcript = parseTranscript(data.transcript);
      liveStatusRaw = String(data.status ?? "");
      liveState = mapStatus(liveStatusRaw);
      hasAudio = Boolean(data.has_audio);
      const metadata = (data.metadata ?? {}) as Record<string, unknown>;
      const dur = Number(
        metadata.call_duration_secs ?? metadata.call_duration ?? NaN,
      );
      liveDuration = Number.isFinite(dur) ? dur : null;
      terminationReason = String(
        metadata.termination_reason ?? metadata.call_termination_reason ?? "",
      );
      const analysis = (data.analysis ?? {}) as Record<string, unknown>;
      liveSummary = String(analysis.transcript_summary ?? "");
      liveSentiment = asSentiment(analysis.user_sentiment);
    } catch {
      /* not queryable yet — degrade to store / DB */
    }
  }

  let store = getAICall(conversationId);
  let db = await getAIConversation(conversationId);

  // ── Finalize a watched call that just reached a terminal state (once) ───────
  const alreadyFinal = isTerminal(store?.state) || isTerminal(db?.state);
  if (liveState && isTerminal(liveState) && !alreadyFinal) {
    await finalizeAIConversation({
      conversationId,
      turns: rawTurns,
      status: liveStatusRaw,
      durationSec: liveDuration ?? undefined,
      terminationReason,
    });
    store = getAICall(conversationId);
    db = await getAIConversation(conversationId);
  } else if (
    store &&
    liveState &&
    liveState !== store.state &&
    !isTerminal(liveState)
  ) {
    // Live, non-terminal transition (e.g. initiated → in_progress).
    updateAICall(conversationId, { state: liveState });
    store = getAICall(conversationId);
  }

  if (!store && !db && transcript.length === 0 && !liveState) {
    return NextResponse.json(
      { error: "Conversation not found" },
      { status: 404 },
    );
  }

  const state: AICallState =
    store?.state ?? liveState ?? ((db?.state as AICallState) ?? "completed");

  const response: DetailResponse = {
    conversationId,
    leadId: store?.leadId ?? null,
    leadName: store?.leadName ?? db?.leadName ?? "",
    phone: store?.phone ?? db?.phone ?? "",
    city: store?.city ?? "",
    state,
    sentiment:
      store?.sentiment ??
      (db ? asSentiment(db.sentiment) : null) ??
      liveSentiment ??
      "neutral",
    outcome: store?.outcome ?? (db?.outcome as CallOutcome | null) ?? null,
    summary: store?.summary ?? db?.summary ?? liveSummary ?? "",
    durationSec: store?.durationSec ?? liveDuration ?? db?.durationSec ?? null,
    startedAt: store?.startedAt ?? null,
    recordingAvailable:
      (store?.recordingAvailable ?? db?.recordingAvailable ?? hasAudio) &&
      state === "completed",
    transcript,
    appointment: store?.appointment ?? db?.appointment ?? null,
    configured: isElevenLabsConfigured(),
  };

  return NextResponse.json(response);
}
