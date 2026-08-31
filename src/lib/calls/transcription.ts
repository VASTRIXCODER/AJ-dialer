import { twilioConfig } from "../twilio";

// ─────────────────────────────────────────────────────────────────────────────
// Speech-to-text for RECORDED calls.
//
// Manual calls have always been recorded — the rep's leg opens the conference
// with record="record-from-start" and the URL lands on call_records.recording_url
// (see /api/twilio/status). Nothing ever turned that audio into words, which is
// why the archive could search AI calls by what was said and manual calls only
// by name, number and notes. This is the missing half.
//
// Two providers, auto-detected, in the same shape reverse-search uses:
//
//  • ElevenLabs Scribe — the default, because an org running the AI dialer
//    ALREADY has ELEVENLABS_API_KEY, so transcripts need no new credential.
//    `detect_speaker_roles` labels the two voices "agent"/"customer", which
//    maps straight onto the Agent:/Contact: format the archive renders.
//  • Deepgram — opt-in via DEEPGRAM_API_KEY; cheaper per minute at volume.
//
// With neither key the feature is simply off: isTranscriptionConfigured() is
// false and every caller no-ops. Nothing crashes, exactly the way Twilio and
// Claude degrade elsewhere.
// ─────────────────────────────────────────────────────────────────────────────

/** One speaker turn, in the shape `flattenTranscript` and the transcript panel
 *  already expect ("agent" is the rep; anything else renders as Contact). */
export interface TranscriptTurn {
  role: "agent" | "user";
  message: string;
  secs: number | null;
}

export type TranscriptionProvider = "elevenlabs" | "deepgram";

export interface TranscriptionResult {
  turns: TranscriptTurn[];
  /** Flat text as the provider returned it (before role prefixing). */
  text: string;
  provider: TranscriptionProvider;
  durationSec: number | null;
}

export const transcriptionConfig = {
  /** Force a provider; otherwise the first configured one wins. */
  provider: (process.env.TRANSCRIPTION_PROVIDER ?? "").trim().toLowerCase(),
  elevenLabsKey: process.env.ELEVENLABS_API_KEY ?? "",
  deepgramKey: process.env.DEEPGRAM_API_KEY ?? "",
  /** Scribe model. v2 is current; pinned so a provider default can't shift
   *  transcript quality under a workspace without a deploy. */
  elevenLabsModel: (process.env.TRANSCRIPTION_MODEL ?? "scribe_v2").trim(),
  deepgramModel: (process.env.DEEPGRAM_MODEL ?? "nova-3").trim(),
};

/**
 * Recordings shorter than this are never sent to a provider. A 2-second
 * conference recording is a click and a dial tone — transcribing it costs money
 * and returns nothing, and every no-answer produces one.
 */
export const MIN_TRANSCRIBABLE_SEC = 5;

/** The provider that will actually be used, or null when none is usable. */
export function transcriptionProvider(): TranscriptionProvider | null {
  const forced = transcriptionConfig.provider;
  if (forced === "elevenlabs") return transcriptionConfig.elevenLabsKey ? "elevenlabs" : null;
  if (forced === "deepgram") return transcriptionConfig.deepgramKey ? "deepgram" : null;
  if (forced === "off" || forced === "none") return null;
  // Auto: prefer the credential the workspace most likely already has.
  if (transcriptionConfig.elevenLabsKey) return "elevenlabs";
  if (transcriptionConfig.deepgramKey) return "deepgram";
  return null;
}

export function isTranscriptionConfigured(): boolean {
  return transcriptionProvider() !== null;
}

export function transcriptionProviderName(): string {
  const p = transcriptionProvider();
  return p === "elevenlabs" ? "ElevenLabs Scribe" : p === "deepgram" ? "Deepgram" : "None";
}

/** A human-readable reason transcription can't run, or null when it can. */
export function transcriptionConfigProblem(): string | null {
  const forced = transcriptionConfig.provider;
  if (forced === "off" || forced === "none") {
    return "Transcription is switched off (TRANSCRIPTION_PROVIDER=off).";
  }
  if (forced === "elevenlabs" && !transcriptionConfig.elevenLabsKey) {
    return "TRANSCRIPTION_PROVIDER=elevenlabs but ELEVENLABS_API_KEY is not set.";
  }
  if (forced === "deepgram" && !transcriptionConfig.deepgramKey) {
    return "TRANSCRIPTION_PROVIDER=deepgram but DEEPGRAM_API_KEY is not set.";
  }
  if (forced && !["elevenlabs", "deepgram"].includes(forced)) {
    return `Unknown TRANSCRIPTION_PROVIDER "${forced}" — use "elevenlabs" or "deepgram".`;
  }
  if (!isTranscriptionConfigured()) {
    return "No speech-to-text provider is configured. Set ELEVENLABS_API_KEY (Scribe) or DEEPGRAM_API_KEY.";
  }
  if (!twilioConfig.accountSid || !twilioConfig.authToken) {
    return "Twilio REST credentials are needed to download the recording (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).";
  }
  return null;
}

// ── Fetching the audio ───────────────────────────────────────────────────────

/**
 * Download a Twilio recording. The URL Twilio hands us in the webhook has no
 * extension and is NOT public — it needs Basic auth with the account
 * credentials, which is also why we can't just hand the URL to a provider and
 * let it fetch (the same reason /api/twilio/recording/[sid] proxies playback).
 */
export async function fetchRecordingAudio(
  recordingUrl: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const { accountSid, authToken } = twilioConfig;
  if (!accountSid || !authToken || !recordingUrl) return null;
  // Twilio serves .mp3 (small, universally accepted) when asked explicitly.
  const url = /\.(mp3|wav)$/i.test(recordingUrl) ? recordingUrl : `${recordingUrl}.mp3`;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
    });
    if (!res.ok) return null;
    const bytes = await res.arrayBuffer();
    if (!bytes.byteLength) return null;
    return { bytes, contentType: res.headers.get("content-type") || "audio/mpeg" };
  } catch {
    return null;
  }
}

// ── Speaker → role ───────────────────────────────────────────────────────────

/**
 * Map raw diarization labels onto rep/contact.
 *
 * With ElevenLabs `detect_speaker_roles` the labels ARE "agent"/"customer" and
 * this is exact. Otherwise we fall back to order: these are OUTBOUND calls, so
 * the voice heard first is the person picking up ("Hello?"), not the rep. That
 * is a heuristic and can be wrong on a voicemail greeting — which is precisely
 * why the exact path is preferred and this only covers providers without it.
 */
function roleMapper(speakers: string[]): (speaker: string) => "agent" | "user" {
  const explicit = speakers.some((s) => s === "agent" || s === "customer");
  if (explicit) return (s) => (s === "agent" ? "agent" : "user");
  const first = speakers[0];
  return (s) => (s === first ? "user" : "agent");
}

// ── ElevenLabs Scribe ────────────────────────────────────────────────────────

export interface ScribeWord {
  text?: string;
  start?: number;
  end?: number;
  type?: string;
  speaker_id?: string;
}

/**
 * Regroup Scribe's word stream into speaker turns. Pure, so the grouping rules
 * that actually decide what a transcript reads like are testable without a key.
 *
 * "spacing" tokens carry the whitespace between words and belong to the turn in
 * progress; "audio_event" tokens are dropped.
 */
export function turnsFromScribeWords(words: ScribeWord[]): TranscriptTurn[] {
  const groups: { speaker: string; text: string; start: number | null }[] = [];
  for (const w of words) {
    if (w.type === "audio_event") continue;
    if (w.type === "spacing") {
      if (groups.length) groups[groups.length - 1].text += w.text ?? " ";
      continue;
    }
    const speaker = String(w.speaker_id ?? "speaker_0");
    const last = groups[groups.length - 1];
    if (!last || last.speaker !== speaker) {
      groups.push({
        speaker,
        text: w.text ?? "",
        start: typeof w.start === "number" ? w.start : null,
      });
    } else {
      last.text += w.text ?? "";
    }
  }
  const toRole = roleMapper(groups.map((g) => g.speaker));
  return groups
    .map((g) => ({ role: toRole(g.speaker), message: g.text.trim(), secs: g.start }))
    .filter((t) => t.message.length > 0);
}

export interface DeepgramUtterance {
  start?: number;
  transcript?: string;
  speaker?: number;
}

/** Deepgram utterances ARE turns — it groups diarized speech for us. Pure for
 *  the same reason as above. */
export function turnsFromDeepgramUtterances(
  utterances: DeepgramUtterance[],
): TranscriptTurn[] {
  const toRole = roleMapper(utterances.map((u) => String(u.speaker ?? 0)));
  return utterances
    .map((u) => ({
      role: toRole(String(u.speaker ?? 0)),
      message: String(u.transcript ?? "").trim(),
      secs: typeof u.start === "number" ? u.start : null,
    }))
    .filter((t) => t.message.length > 0);
}

async function transcribeWithElevenLabs(
  bytes: ArrayBuffer,
  contentType: string,
): Promise<TranscriptionResult> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), "call.mp3");
  form.append("model_id", transcriptionConfig.elevenLabsModel);
  form.append("diarize", "true");
  // Two parties on a conference call. Bounding it keeps diarization from
  // inventing a third voice out of line noise.
  form.append("num_speakers", "2");
  // The whole reason this provider is the default: it labels the voices
  // agent/customer instead of speaker_0/speaker_1.
  form.append("detect_speaker_roles", "true");
  form.append("timestamps_granularity", "word");
  // No "[laughter]" / "[door slams]" tokens — this transcript is read as a call
  // record and searched as text, and audio events are noise in both.
  form.append("tag_audio_events", "false");

  const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: { "xi-api-key": transcriptionConfig.elevenLabsKey },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `ElevenLabs Scribe ${res.status}: ${detail.slice(0, 300) || res.statusText}`,
    );
  }
  const json = (await res.json()) as {
    text?: string;
    audio_duration_secs?: number;
    words?: ScribeWord[];
  };

  const turns = turnsFromScribeWords(Array.isArray(json.words) ? json.words : []);

  return {
    turns,
    text: String(json.text ?? ""),
    provider: "elevenlabs",
    durationSec:
      typeof json.audio_duration_secs === "number" ? json.audio_duration_secs : null,
  };
}

// ── Deepgram ─────────────────────────────────────────────────────────────────

async function transcribeWithDeepgram(
  bytes: ArrayBuffer,
  contentType: string,
): Promise<TranscriptionResult> {
  const qs = new URLSearchParams({
    model: transcriptionConfig.deepgramModel,
    diarize: "true",
    punctuate: "true",
    // Utterances ARE turns — Deepgram groups diarized speech for us, so we
    // don't have to re-group words the way Scribe needs.
    utterances: "true",
    smart_format: "true",
  });
  const res = await fetch(`https://api.deepgram.com/v1/listen?${qs}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${transcriptionConfig.deepgramKey}`,
      "Content-Type": contentType,
    },
    body: bytes,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Deepgram ${res.status}: ${detail.slice(0, 300) || res.statusText}`);
  }
  const json = (await res.json()) as {
    metadata?: { duration?: number };
    results?: {
      utterances?: { start?: number; transcript?: string; speaker?: number }[];
      channels?: { alternatives?: { transcript?: string }[] }[];
    };
  };

  const turns = turnsFromDeepgramUtterances(json.results?.utterances ?? []);

  return {
    turns,
    text: String(json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ""),
    provider: "deepgram",
    durationSec: typeof json.metadata?.duration === "number" ? json.metadata.duration : null,
  };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Transcribe a Twilio recording URL end to end. Returns null when the feature
 * isn't configured or the audio can't be fetched; THROWS when the provider
 * itself errors, so a caller can tell "not set up" from "it broke" and surface
 * the difference instead of silently writing nothing.
 */
export async function transcribeRecording(
  recordingUrl: string,
): Promise<TranscriptionResult | null> {
  const provider = transcriptionProvider();
  if (!provider) return null;
  const audio = await fetchRecordingAudio(recordingUrl);
  if (!audio) return null;
  return provider === "elevenlabs"
    ? transcribeWithElevenLabs(audio.bytes, audio.contentType)
    : transcribeWithDeepgram(audio.bytes, audio.contentType);
}
