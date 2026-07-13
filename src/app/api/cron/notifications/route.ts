import { NextResponse } from "next/server";
import { drainOutbox } from "@/lib/notifications/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Drains the notification outbox: sends every "appointment set / moved /
 * cancelled" email that is due, retries the ones that failed, and gives up
 * (loudly, in-app) on the ones that have exhausted their attempts.
 *
 * This route is OPTIONAL. The same drain already rides the per-minute
 * /api/cron/reconcile-ai tick, so notifications work with no scheduling change at
 * all — which is the point, because the schedule lives in hand-applied Supabase
 * pg_cron SQL that is not in this repo (docs/CRON.md), and a job somebody forgets
 * to create is a feature that silently never runs.
 *
 * Schedule this one too if you'd rather the email path not share a budget with
 * the AI reconciler; see docs/CRON.md. Running both is harmless — the drain claims
 * rows by flipping their status, so a double-fire sends nothing twice.
 *
 * Security: identical to the other crons. `Authorization: Bearer $CRON_SECRET`,
 * fail-closed with no secret, GET and POST both accepted so any scheduler works.
 */
async function runDrain(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set — refusing to run the notification drain." },
      { status: 503 },
    );
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await drainOutbox({ budgetMs: 50_000, limit: 100 });

  if (result.failed > 0) {
    console.error(
      `[cron.notifications] ${result.failed} notification(s) exhausted their retries and are now ` +
        "surfaced in-app (bell + calendar banner). Check Admin → Notifications and RESEND_API_KEY.",
    );
  }

  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), ...result });
}

export const GET = runDrain;
export const POST = runDrain;
