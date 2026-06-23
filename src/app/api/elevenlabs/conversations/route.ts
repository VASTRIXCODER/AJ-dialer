import { NextResponse } from "next/server";
import { reconcileActiveCalls } from "@/lib/ai-call-reconcile";
import {
  listActiveAICalls,
  listRecentAICalls,
  type AICall,
} from "@/lib/ai-call-store";
import { getAIConversationsForMonitor } from "@/lib/db/records";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";
import { viewerCan } from "@/lib/org/membership";

export const dynamic = "force-dynamic";

type Loose = AICall | Awaited<
  ReturnType<typeof getAIConversationsForMonitor>
>["active"][number];

/** Merge the live in-memory store with durable Supabase rows, newest wins. */
function merge(memory: Loose[], db: Loose[]): Loose[] {
  const byId = new Map<string, Loose>();
  for (const c of db) byId.set(c.conversationId, c);
  for (const c of memory) byId.set(c.conversationId, c); // in-memory is freshest
  return [...byId.values()];
}

/**
 * Feeds the Live Monitor with active + recent AI calls. Reads the in-memory
 * store merged with Supabase (durable across refreshes / serverless instances),
 * and — critically — reconciles every active call against ElevenLabs first, so
 * connected/failed/no-answer calls end and get categorized automatically
 * instead of hanging "live" forever.
 */
export async function GET() {
  // Live monitoring is supervisors-only — reps never see the floor's calls.
  if (!(await viewerCan("monitor.view")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const first = await getAIConversationsForMonitor();
  const activeForCheck = merge(listActiveAICalls(), first.active);

  // Reconcile only when something is actually live; re-read so just-ended calls
  // move to "recent" in the same response.
  let fresh = first;
  if (activeForCheck.length > 0) {
    await reconcileActiveCalls(
      activeForCheck.map((c) => ({
        conversationId: c.conversationId,
        startedAt: c.startedAt,
      })),
    );
    fresh = await getAIConversationsForMonitor();
  }

  const active = merge(listActiveAICalls(), fresh.active).sort(
    (a, b) => b.startedAt - a.startedAt,
  );
  const recent = merge(listRecentAICalls(), fresh.recent)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, 12);

  return NextResponse.json(
    {
      configured: isElevenLabsConfigured(),
      active,
      recent,
    },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
