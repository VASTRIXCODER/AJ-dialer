import { NextResponse } from "next/server";
import { orchestrationTick } from "@/lib/orchestration/engine";
import { runOrchestrationSweeps } from "@/lib/orchestration/events";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Phase 2 orchestration tick (P2.1): wake waiting playbook instances,
 * evaluate stop rules, execute due steps from the v0 allow-list — all behind
 * the four-level kill-switch hierarchy (global app_settings.orchestration_paused
 * → org settings.orchestration.enabled, default OFF → playbook paused →
 * opportunity stop rules). Exactly-once per step via playbook_executions'
 * UNIQUE idempotency key.
 *
 * Schedule from Supabase pg_cron via app_fire_cron('/api/cron/orchestrate') —
 * see supabase/cron.sql. Until an org flips settings.orchestration.enabled on,
 * every tick is a no-op by design.
 *
 * Security: `Authorization: Bearer $CRON_SECRET`, exactly like the Phase 1
 * crons. No secret configured ⇒ refuse to run.
 */
async function runTick(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET is not set — refusing to run the orchestrator." },
      { status: 503 },
    );
  }
  if ((req.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  // Sweeps first (they ACTIVATE instances), then the tick (it EXECUTES them —
  // a fresh activation's first step often runs on the same tick).
  const sweeps = await runOrchestrationSweeps();
  const result = await orchestrationTick();
  return NextResponse.json({ ok: true, ranAt: new Date().toISOString(), sweeps, ...result });
}

export const GET = runTick;
export const POST = runTick;
