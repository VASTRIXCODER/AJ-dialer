import { NextResponse } from "next/server";
import {
  listActiveAICalls,
  listRecentAICalls,
  type AICall,
} from "@/lib/ai-call-store";
import { getAIConversationsForMonitor } from "@/lib/db/records";
import { isElevenLabsConfigured } from "@/lib/elevenlabs";

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
 * Feeds the Live Monitor + dialer with active and recent AI calls. Reads from
 * the in-memory store (instant, live) merged with Supabase (durable across
 * refreshes and serverless instances) so calls never silently disappear.
 */
export async function GET() {
  const { active: dbActive, recent: dbRecent } =
    await getAIConversationsForMonitor();

  const active = merge(listActiveAICalls(), dbActive).sort(
    (a, b) => b.startedAt - a.startedAt,
  );
  const recent = merge(listRecentAICalls(), dbRecent)
    .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
    .slice(0, 8);

  return NextResponse.json({
    configured: isElevenLabsConfigured(),
    active,
    recent,
  });
}
