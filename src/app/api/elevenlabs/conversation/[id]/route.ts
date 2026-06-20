import { NextResponse } from "next/server";
import {
  getAICall,
  updateAICall,
  type AICall,
  type AICallState,
} from "@/lib/ai-call-store";
import { unconnectedOutcome, dispositionBlurb } from "@/lib/call-disposition";
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

function asSentiment(v: unknown): Sentiment {
  return v === "positive" || v === "negative" ? v : "neutral";
}

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
 * (durable, account-scoped fallback that survives restarts / serverless).
 * Also reconciles a call that "didn't go through" so the UI ends + categorizes
 * it automatically even if the post-call webhook hasn't landed yet.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const conversationId = decodeURIComponent(id);

  // ── Live ElevenLabs read (best-effort; a still-ringing call may 404) ────────
  let transcript: TranscriptTurn[] = [];
  let liveState: AICallState | null = null;
  let liveDuration: number | null = null;
  let liveSummary = "";
  let liveSentiment: Sentiment | null = null;
  let hasAudio = false;
  let terminationReason = "";

  if (isElevenLabsConfigured()) {
    try {
      const convo = (await getConversation(conversationId)) as Record<
        string,
        unknown
      >;
      const data = (convo.data ?? convo) as Record<string, unknown>;
      transcript = parseTranscript(data.transcript);
      liveState = mapStatus(data.status as string | undefined);
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

  // ── Reconcile the in-memory store from the live state (best-effort) ─────────
  const tracked = getAICall(conversationId);
  if (tracked && liveState && liveState !== tracked.state) {
    const ended = liveState === "completed" || liveState === "failed";
    const patch: Partial<AICall> = { state: liveState };
    if (ended) {
      patch.endedAt = tracked.endedAt ?? Date.now();
      if (liveDuration != null) patch.durationSec = liveDuration;
      if (hasAudio) patch.recordingAvailable = true;
      // Call ended without the homeowner speaking → it didn't go through.
      if (transcript.length === 0 && !tracked.outcome) {
        const auto = unconnectedOutcome(terminationReason, liveDuration ?? 0);
        patch.state = "failed";
        patch.outcome = auto;
        patch.summary = tracked.summary || dispositionBlurb(auto);
        patch.recordingAvailable = false;
      }
    }
    updateAICall(conversationId, patch);
  }

  // ── Assemble the response: store → live → DB ────────────────────────────────
  const store = getAICall(conversationId);
  const db = store ? null : await getAIConversation(conversationId);

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
    configured: isElevenLabsConfigured(),
  };

  return NextResponse.json(response);
}
