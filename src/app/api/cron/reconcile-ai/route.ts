import { NextResponse } from "next/server";
import { reconcileStuckConversations } from "@/lib/ai-call-reconcile";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { drainOutbox } from "@/lib/notifications/outbox";
import { isRestConfigured } from "@/lib/twilio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The stuck-call reconciler. This is the system's GUARANTEE that every AI call
 * eventually reaches a terminal state with an honest verdict.
 *
 * reconcileStuckConversations() has existed — complete, keyset-paged, budgeted —
 * for some time, and its own header calls it "the actual guarantee that every call
 * gets finalized". It had zero callers. Nothing scheduled it, this route did not
 * exist, and vercel.json ran only the auto-dialer. Meanwhile the health endpoint
 * has been telling operators to "check that the cron (/api/cron/reconcile-ai) is
 * running" — advice about a job that was never built. The guarantee was a comment.
 *
 * What actually drained stuck calls was reconcileActiveCalls(), which only runs
 * while a supervisor happens to have the Live Monitor open, only sees their own
 * org, and only touches 8 calls per poll. That is how a backlog of thousands of
 * never-finalized calls accumulated.
 *
 * This route is the backstop, NOT the fast path. The fast path is Twilio pushing
 * ringing/answered/no-answer at /api/twilio/status within a second of the real
 * event. This exists to catch what push cannot: a dropped webhook, a call placed
 * while the app was down, a provider that went silent mid-call.
 *
 * Security: requires `Authorization: Bearer $CRON_SECRET`. Vercel Cron sends this
 * automatically when CRON_SECRET is set; external schedulers must add it. With no
 * secret configured we refuse to run, exactly like the auto-dialer.
 */
async function runReconcile(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set — refusing to run the reconciler." },
      { status: 503 },
    );
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // ── Appointment notifications ride this tick ────────────────────────────────
  // Deliberately BEFORE the telephony guard below, and deliberately not on a cron
  // of its own. Per-minute crons cannot live in vercel.json — on the Hobby plan a
  // `* * * * *` expression makes the whole DEPLOYMENT fail, which once froze prod
  // on 13-day-old code for two weeks (see docs/CRON.md). The schedule is therefore
  // hand-applied pg_cron SQL that is not in this repo — which means a NEW job is a
  // step someone can simply forget, and a forgotten job here would mean the
  // "appointment set" email silently never sends. Riding the tick that already
  // exists makes the feature work the moment this code deploys. A dedicated
  // /api/cron/notifications route also exists if you'd rather schedule it properly.
  //
  // Tight budget: this must not eat the reconciler's headroom under maxDuration.
  const outbox = await drainOutbox({ budgetMs: 8_000, limit: 25 });

  // Twilio alone can resolve a call that never connected — and on the homeowner's
  // phone it is the ONLY witness. Only refuse when we have neither provider to ask.
  if (!isElevenLabsConfigured() && !isRestConfigured()) {
    return NextResponse.json({
      ok: true,
      skipped: "no ElevenLabs or Twilio credentials",
      outbox,
    });
  }

  // Leave headroom under maxDuration so we always return a real report instead of
  // being killed mid-page — `moreRemaining` tells the next tick to keep going.
  // 45s, not 50: the outbox drain above may already have spent up to 8 of the 60.
  const result = await reconcileStuckConversations({ budgetMs: 45_000 });

  if (result.moreRemaining) {
    console.warn(
      `[cron.reconcile-ai] budget exhausted with work left — checked=${result.checked} ` +
        `finalized=${result.finalized} errors=${result.errors}. A backlog this deep means calls ` +
        "are not being finalized on the push path; check the Twilio status webhook.",
    );
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result, outbox });
}

// Vercel Cron issues a GET; support POST too for external schedulers / testing.
export const GET = runReconcile;
export const POST = runReconcile;
