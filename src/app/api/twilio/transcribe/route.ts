import { NextResponse } from "next/server";
import { getCallTranscriptRef, saveCallTranscript } from "@/lib/db/records";
import { speechToText } from "@/lib/elevenlabs";
import { twilioConfig } from "@/lib/twilio";

export const dynamic = "force-dynamic";

// Twilio recording SIDs are "RE" + 32 hex chars.
const RECORDING_SID = /\/Recordings\/(RE[0-9a-f]{32})/i;

/**
 * Generate (and cache) a transcript for a MANUAL call's recording.
 *
 * AI calls get a transcript from ElevenLabs; manual (Twilio) calls didn't. The
 * Reports → manual-call detail calls this on open: it returns the cached
 * transcript if one exists, otherwise it pulls the conference recording from
 * Twilio (private media → fetched server-side with the account credentials),
 * runs it through ElevenLabs Speech-to-Text, caches the result on the record,
 * and returns it. Scoped to the viewer via RLS in getCallTranscriptRef.
 */
export async function POST(req: Request) {
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id) {
    return NextResponse.json({ error: "A call id is required." }, { status: 400 });
  }

  const ref = await getCallTranscriptRef(id);
  if (!ref) {
    return NextResponse.json({ error: "Call not found." }, { status: 404 });
  }

  // Already transcribed — serve the cache.
  if (ref.transcript) {
    return NextResponse.json({ transcript: ref.transcript, cached: true });
  }

  if (!ref.recordingUrl) {
    // The recording webhook hasn't landed yet (Twilio is still processing).
    return NextResponse.json({ transcript: null, pending: true });
  }

  if (!twilioConfig.accountSid || !twilioConfig.authToken) {
    return NextResponse.json(
      { transcript: null, error: "Twilio credentials are required to read the recording." },
      { status: 503 },
    );
  }

  // Resolve a playable mp3 URL for the recording (private Twilio media).
  const sidMatch = RECORDING_SID.exec(ref.recordingUrl);
  const mediaUrl = sidMatch
    ? `https://api.twilio.com/2010-04-01/Accounts/${twilioConfig.accountSid}/Recordings/${sidMatch[1]}.mp3`
    : ref.recordingUrl;

  try {
    const auth = Buffer.from(
      `${twilioConfig.accountSid}:${twilioConfig.authToken}`,
    ).toString("base64");
    const audioRes = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${auth}` },
      cache: "no-store",
    });
    if (!audioRes.ok) {
      return NextResponse.json(
        { transcript: null, error: "The recording isn't available yet.", pending: true },
        { status: 200 },
      );
    }
    const audio = await audioRes.blob();

    const transcript = await speechToText(audio);
    if (!transcript) {
      return NextResponse.json(
        { transcript: null, error: "Transcription isn't configured on this server." },
        { status: 200 },
      );
    }

    await saveCallTranscript(id, transcript);
    return NextResponse.json({ transcript });
  } catch (e) {
    return NextResponse.json(
      {
        transcript: null,
        error: e instanceof Error ? e.message : "Couldn't transcribe this call.",
      },
      { status: 200 },
    );
  }
}
