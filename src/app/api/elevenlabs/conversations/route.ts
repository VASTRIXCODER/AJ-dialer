import { NextResponse } from "next/server";
import { reconcileActiveCalls, reconcileViaTwilio } from "@/lib/ai-call-reconcile";
import {
  listActiveAICalls,
  listRecentAICalls,
} from "@/lib/ai-call-store";
import { getAIConversationsForMonitor, getAITodayStats } from "@/lib/db/records";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { mergeMonitorAICalls as merge } from "@/lib/monitor/floor-data";
import { viewerCan, viewerOrgId } from "@/lib/org/membership";
import { isTerminalLiveState } from "@/lib/types";

export const dynamic = "force-dynamic";

// The store⊕DB merge ("the DATABASE WINS ON STATE" — see the history in
// mergeMonitorAICalls' doc comment) now lives in src/lib/monitor/floor-data.ts,
// shared with the Live Floor's /api/floor/snapshot so the two feeds can never
// disagree about what "merged" means.

/**
 * Only reconcile against ElevenLabs this often. The feed is polled every 2s per
 * supervisor; making every poll wait on up to 8 ElevenLabs round-trips made the
 * monitor's latency scale with the number of live calls — the opposite of what a
 * live monitor is for.
 *
 * It stays in the request path at all (rather than being deleted outright) because
 * the cron drainer only runs on Vercel. A self-hosted deployment with no scheduler
 * would otherwise have no ElevenLabs-side finalizer at all.
 */
const EL_RECONCILE_EVERY_MS = 8_000;
let lastElReconcile = 0;

/**
 * Feeds the Live Monitor with active + recent AI calls.
 *
 * The truth arrives here by three routes, fastest first:
 *   1. Twilio pushes ringing / answered / no-answer to /api/twilio/status within
 *      ~1s of the real event (bridge mode). By the time this feed runs, the row is
 *      already correct — this is just a DB read.
 *   2. reconcileViaTwilio asks Twilio directly about calls that haven't connected
 *      yet, which is the only signal available in direct mode.
 *   3. reconcileActiveCalls asks ElevenLabs, throttled — the slow, last-resort path.
 * And /api/cron/reconcile-ai guarantees anything all three miss is still finalized.
 */
export async function GET() {
  // Live monitoring is supervisors-only — reps never see the floor's calls.
  if (!(await viewerCan("monitor.view")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const orgId = await viewerOrgId();
  if (!orgId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const first = await getAIConversationsForMonitor();
  const active = merge(listActiveAICalls(orgId), first.active);

  let fresh = first;
  if (active.length > 0) {
    const ids = active.map((c) => c.conversationId);

    // Cheap + authoritative: is their phone actually ringing, or did it ring out?
    await reconcileViaTwilio(ids);

    // Expensive: only every EL_RECONCILE_EVERY_MS, and only for calls old enough
    // that ElevenLabs could plausibly have a verdict we don't.
    const now = Date.now();
    if (now - lastElReconcile > EL_RECONCILE_EVERY_MS) {
      lastElReconcile = now;
      await reconcileActiveCalls(
        active.map((c) => ({
          conversationId: c.conversationId,
          startedAt: c.startedAt,
        })),
      );
    }
    // Re-read so a call that just ended moves to "recent" in this same response.
    fresh = await getAIConversationsForMonitor();
  }

  const merged = merge(
    [...listActiveAICalls(orgId), ...listRecentAICalls(orgId, 12)],
    [...fresh.active, ...fresh.recent],
  );

  // Whole-day totals for the KPI strip. The `recent` list below stays a short
  // feed of the just-finished calls; the tiles read from `today` so "Completed /
  // Connect rate / Appointments" reflect the day, not the last ≤12 cards.
  const today = await getAITodayStats();

  return NextResponse.json(
    {
      configured: isElevenLabsConfigured(),
      today,
      active: merged
        .filter((c) => !isTerminalLiveState(c.state))
        .sort((a, b) => b.startedAt - a.startedAt),
      recent: merged
        .filter((c) => isTerminalLiveState(c.state))
        .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
        .slice(0, 12),
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
