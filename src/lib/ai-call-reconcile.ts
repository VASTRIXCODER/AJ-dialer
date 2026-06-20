import "server-only";

import { finalizeAIConversation } from "./ai-call-finalize";
import { getAIConversationsForMonitor } from "./db/records";
import { fetchConversation, isElevenLabsConfigured } from "./elevenlabs";

// ─────────────────────────────────────────────────────────────────────────────
// Active-call reconciliation. Serverless has no background workers, so the Live
// Monitor's polling drives this: for every call still marked active, we ask
// ElevenLabs for the real status and finalize it the moment it's done / failed /
// never connected — and force-close anything stuck past a hard cap. This is what
// keeps sessions from hanging "live" for hours and makes the system actually
// check whether each call went through.
// ─────────────────────────────────────────────────────────────────────────────

// A call genuinely in progress won't exceed this; past it we force-close.
const MAX_AGE_MS = 12 * 60_000;
// Cap ElevenLabs lookups per poll so the monitor stays snappy.
const CHECK_LIMIT = 8;

const TERMINAL = new Set(["done", "completed", "failed", "processing"]);
const inFlight = new Set<string>(); // guards against double-finalizing within an instance

export interface ActiveRef {
  conversationId: string;
  startedAt: number;
}

export async function reconcileActiveCalls(active: ActiveRef[]): Promise<void> {
  if (!isElevenLabsConfigured() || active.length === 0) return;

  const batch = active
    .filter((c) => !inFlight.has(c.conversationId))
    .slice(0, CHECK_LIMIT);

  await Promise.all(
    batch.map(async (c) => {
      inFlight.add(c.conversationId);
      try {
        const convo = await fetchConversation(c.conversationId);
        const status = (convo?.status ?? "").toLowerCase();
        const tooOld = Date.now() - c.startedAt > MAX_AGE_MS;

        if (status && TERMINAL.has(status)) {
          await finalizeAIConversation({
            conversationId: c.conversationId,
            turns: convo?.turns ?? [],
            status,
            durationSec: convo?.durationSec ?? undefined,
            terminationReason: convo?.terminationReason,
          });
        } else if (tooOld) {
          // ElevenLabs never reported terminal (or is unreachable) — close it out.
          await finalizeAIConversation({
            conversationId: c.conversationId,
            turns: convo?.turns ?? [],
            status: "failed",
            durationSec: convo?.durationSec ?? undefined,
            terminationReason: "timeout",
          });
        }
      } catch {
        /* best-effort — try again on the next poll */
      } finally {
        inFlight.delete(c.conversationId);
      }
    }),
  );
}

/**
 * Convenience: reconcile the signed-in account's own active calls. Called
 * wherever live/derived data is read (monitor feed, dashboard, reports,
 * appointments) so a call that connected, failed, or never answered is ended +
 * categorized even if no one is watching the monitor and the webhook is silent.
 */
export async function reconcileOwnerActiveCalls(): Promise<void> {
  if (!isElevenLabsConfigured()) return;
  try {
    const { active } = await getAIConversationsForMonitor();
    if (active.length === 0) return;
    await reconcileActiveCalls(
      active.map((c) => ({
        conversationId: c.conversationId,
        startedAt: c.startedAt,
      })),
    );
  } catch {
    /* best-effort */
  }
}
