import { NextResponse } from "next/server";
import { drainMessages, flagStuckMessages } from "@/lib/messaging/drain";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The send drain.
 *
 * Its OWN schedule, deliberately not riding reconcile-ai: that job's 60-second
 * budget already has about seven seconds spare, and more importantly a message
 * incident has to be stoppable without also stopping the AI reconciler. One
 * `select cron.unschedule('messages')` should silence exactly one thing.
 *
 * Every message is re-judged here against freshly read DNC, consent and caps
 * immediately before the provider call — see drainMessages. Nothing in this
 * route decides whether a message may go; it decides only when to ask.
 *
 * Security: `Authorization: Bearer $CRON_SECRET`, like every other cron. No
 * secret configured ⇒ refuse to run, because an unauthenticated endpoint that
 * sends text messages to real people is not a thing to leave lying around.
 */
async function runDrain(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set — refusing to send anything." },
      { status: 503 },
    );
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const report = await drainMessages();
  // Stuck rows are FLAGGED, never retried — see flagStuckMessages. Runs after
  // the drain so a row that just moved is not caught by its own tick.
  const stuck = await flagStuckMessages();

  return NextResponse.json({
    ok: true,
    ranAt: new Date().toISOString(),
    ...report,
    flaggedStuck: stuck,
  });
}

export const GET = runDrain;
export const POST = runDrain;
