import {
  isTranscriptionConfigured,
  MIN_TRANSCRIBABLE_SEC,
  transcribeRecording,
} from "../calls/transcription";
import { mergeSettings } from "../org/settings";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { flattenTranscript } from "./records";

// ─────────────────────────────────────────────────────────────────────────────
// Turn a recorded MANUAL call into a stored transcript.
//
// The recording URL is already reliably attached to call_records (immediately by
// the Twilio webhook, or via the pending_recordings claim when the rep was still
// wrapping up). So transcription needs no new plumbing and no race of its own:
// it is simply "this row has audio and no words yet". That predicate is what the
// webhook kick and the cron sweep both act on, which is why a dropped webhook
// costs a delay rather than a lost transcript.
//
// AI calls are deliberately excluded — ElevenLabs already posts their transcript
// back, and re-transcribing the recording would pay twice for a worse copy.
// ─────────────────────────────────────────────────────────────────────────────

export type TranscribeResult =
  | { ok: true; turns: number; chars: number }
  | { ok: false; reason: string; retryable: boolean };

interface RecordRow {
  id: string;
  org_id: string | null;
  channel: string | null;
  recording_url: string | null;
  transcript_text: string | null;
  duration_sec: number | null;
}

/** Does this workspace want manual calls transcribed? Off unless an admin says
 *  so — an org that set ELEVENLABS_API_KEY for the AI dialer must not silently
 *  start paying for speech-to-text on every human call too. */
export async function orgWantsTranscription(orgId: string | null): Promise<boolean> {
  if (!orgId || !isAdminConfigured()) return false;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("organizations")
      .select("settings")
      .eq("id", orgId)
      .maybeSingle();
    if (!data) return false;
    return mergeSettings((data as { settings?: unknown }).settings).dialing.transcribeCalls;
  } catch {
    return false;
  }
}

/**
 * Transcribe one call record in place. Idempotent: a row that already has
 * `transcript_text` is left alone unless `force` is set, so a replayed webhook
 * or an overlapping cron tick can't double-bill the provider.
 */
export async function transcribeCallRecord(
  recordId: string,
  opts: { force?: boolean } = {},
): Promise<TranscribeResult> {
  if (!isAdminConfigured()) {
    return { ok: false, reason: "Database is not configured.", retryable: false };
  }
  if (!isTranscriptionConfigured()) {
    return { ok: false, reason: "No speech-to-text provider is configured.", retryable: false };
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from("call_records")
    .select("id,org_id,channel,recording_url,transcript_text,duration_sec")
    .eq("id", recordId)
    .maybeSingle();
  const row = data as RecordRow | null;
  if (!row) return { ok: false, reason: "Call record not found.", retryable: false };

  if (row.channel === "ai") {
    return { ok: false, reason: "AI calls carry their own transcript.", retryable: false };
  }
  if (!row.recording_url) {
    // The recording webhook hasn't landed yet — a later sweep will pick it up.
    return { ok: false, reason: "No recording on this call yet.", retryable: true };
  }
  if (row.transcript_text && !opts.force) {
    return { ok: false, reason: "Already transcribed.", retryable: false };
  }
  // The talk timer only starts once the homeowner is bridged, so a duration
  // under the floor means nobody ever spoke — a ring-out or an instant hang-up.
  // Same predicate the sweep uses, so the two paths can't disagree about what
  // is worth paying a per-minute provider for.
  if ((row.duration_sec ?? 0) < MIN_TRANSCRIBABLE_SEC) {
    return { ok: false, reason: "Too short to transcribe.", retryable: false };
  }
  if (!(await orgWantsTranscription(row.org_id))) {
    return { ok: false, reason: "Transcription is off for this workspace.", retryable: false };
  }

  let turns;
  try {
    const result = await transcribeRecording(row.recording_url);
    if (!result) {
      return { ok: false, reason: "Couldn't download the recording.", retryable: true };
    }
    turns = result.turns;
  } catch (err) {
    // A provider error IS retryable (rate limit, transient 5xx) — surface it
    // rather than writing an empty transcript that would look like silence.
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "Transcription failed.",
      retryable: true,
    };
  }

  const text = flattenTranscript(turns);
  if (!text) {
    // Real silence (a voicemail beep, a hang-up). Store a marker so the sweep
    // stops re-paying for the same empty audio every tick.
    await admin.from("call_records").update({ transcript_text: "" }).eq("id", recordId);
    return { ok: false, reason: "No speech detected.", retryable: false };
  }

  await admin.from("call_records").update({ transcript_text: text }).eq("id", recordId);
  return { ok: true, turns: turns.length, chars: text.length };
}

/**
 * Fire-and-forget transcription for a record that just gained a recording.
 *
 * Called from the two places a recording URL can land on a row — the Twilio
 * webhook (record already existed) and insertCallRecord's parked claim (record
 * written after the webhook). Between them the push path covers essentially
 * every call, which is what makes the cron sweep a genuine backstop rather than
 * the mechanism. Never throws and never blocks: the caller is a webhook whose
 * job is to answer Twilio quickly.
 */
export function kickTranscription(recordId: string | null | undefined): void {
  if (!recordId || !isTranscriptionConfigured()) return;
  void (async () => {
    try {
      const res = await transcribeCallRecord(recordId);
      if (!res.ok && res.retryable) {
        console.warn(`[transcribe] ${recordId}: ${res.reason} — the sweep will retry.`);
      }
    } catch {
      /* best-effort — sweepUntranscribedCalls picks up anything dropped here */
    }
  })();
}

/**
 * Find recorded manual calls that have no transcript yet and transcribe them.
 * The cron backstop — bounded per tick so a backlog can't run away with the
 * provider bill or the function's time budget.
 */
export async function sweepUntranscribedCalls(limit = 10): Promise<{
  attempted: number;
  transcribed: number;
}> {
  if (!isAdminConfigured() || !isTranscriptionConfigured()) {
    return { attempted: 0, transcribed: 0 };
  }
  const admin = createAdminClient();
  // Oldest first, so a backlog drains in order instead of starving old calls.
  const { data } = await admin
    .from("call_records")
    .select("id")
    .eq("channel", "human")
    .not("recording_url", "is", null)
    .is("transcript_text", null)
    .gte("duration_sec", MIN_TRANSCRIBABLE_SEC)
    .order("started_at", { ascending: true })
    .limit(limit);

  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  let transcribed = 0;
  for (const id of ids) {
    try {
      const res = await transcribeCallRecord(id);
      if (res.ok) transcribed += 1;
    } catch {
      /* best-effort — the next tick retries whatever failed */
    }
  }
  return { attempted: ids.length, transcribed };
}
