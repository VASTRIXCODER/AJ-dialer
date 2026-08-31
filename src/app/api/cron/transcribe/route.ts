import { NextResponse } from "next/server";
import {
  isTranscriptionConfigured,
  transcriptionConfigProblem,
  transcriptionProviderName,
} from "@/lib/calls/transcription";
import { sweepUntranscribedCalls } from "@/lib/db/transcribe-call";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Transcription backstop.
 *
 * This is NOT the mechanism — the push path is. A recording URL only ever
 * reaches a call record in two places, and both start transcription directly:
 * the Twilio recording webhook (row already existed) and insertCallRecord's
 * parked-recording claim (row written after the webhook). Between them, a call
 * is normally transcribed within seconds of the audio being ready.
 *
 * This route exists for what push cannot cover: a dropped webhook, a provider
 * that rate-limited, a deploy that happened mid-call, or the backlog of calls
 * recorded before transcription was switched on. It re-runs the same predicate
 * — human channel, has audio, has no words yet — so it is safe to call as often
 * as you like and does nothing when there's nothing to do.
 *
 * Scheduling is OPTIONAL. Because the push path covers the normal case, a
 * workspace that never schedules this still gets transcripts; it just loses the
 * retry. Point pg_cron or Vercel Cron at it if you want the guarantee.
 *
 * Security: requires `Authorization: Bearer $CRON_SECRET`, same contract as the
 * sibling crons — with no secret configured we refuse to run.
 */
async function runTranscribeSweep(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set — refusing to run the sweep." },
      { status: 503 },
    );
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isTranscriptionConfigured()) {
    // Not an error — the feature is simply not set up. Report WHY, so an
    // operator reading cron output can see it's a missing key and not a bug.
    return NextResponse.json({
      ok: true,
      skipped: transcriptionConfigProblem() ?? "transcription is not configured",
    });
  }

  // Bounded per tick: speech-to-text bills per minute of audio and each call
  // costs real seconds, so a backlog drains steadily instead of blowing the
  // function's time budget (or the workspace's bill) in one go.
  const result = await sweepUntranscribedCalls(10);

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    provider: transcriptionProviderName(),
    ...result,
  });
}

// Vercel Cron issues a GET; support POST too for external schedulers / testing.
export const GET = runTranscribeSweep;
export const POST = runTranscribeSweep;
