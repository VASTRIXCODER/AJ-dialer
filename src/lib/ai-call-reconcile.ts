import "server-only";

import { finalizeAIConversation } from "./ai-call-finalize";
import { getAIConversationsForMonitor, listStuckAIConversations } from "./db/records";
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

const UNCONNECTED =
  /no[\s_-]?answer|voicemail|machine|answphone|answering|busy|invalid|not[\s_-]?in[\s_-]?service|unallocated|disconnected|timed?[\s_-]?out|timeout|cancel|no[\s_-]?response/i;

/** Did the homeowner actually speak (a real two-way conversation)? */
function hasHumanTurn(turns: { role: string; message: string }[]): boolean {
  return turns.some(
    (t) => t.role !== "agent" && (t.message ?? "").trim().length > 1,
  );
}

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
        const turns = convo?.turns ?? [];

        // "processing" means the call ended but ElevenLabs is still building the
        // transcript/analysis. Don't finalize it until we actually have a
        // transcript (a real conversation) or a clear "didn't connect" signal —
        // otherwise a connected call gets mis-filed as "no answer" before its
        // transcript loads. (done/completed/failed are always safe to finalize.)
        const isProcessing = status === "processing";
        const safeToFinalize =
          status &&
          TERMINAL.has(status) &&
          (!isProcessing ||
            hasHumanTurn(turns) ||
            UNCONNECTED.test(convo?.terminationReason ?? ""));

        if (safeToFinalize) {
          await finalizeAIConversation({
            conversationId: c.conversationId,
            turns,
            status,
            durationSec: convo?.durationSec ?? undefined,
            terminationReason: convo?.terminationReason,
            errorCode: convo?.errorCode ?? null,
            errorReason: convo?.errorReason ?? null,
          });
        } else if (tooOld) {
          // ElevenLabs never reported terminal (or is unreachable) — close it out.
          // If a transcript did load, finalize it as the real (connected) call so a
          // long chat isn't lost. Otherwise we genuinely DON'T KNOW what happened:
          // mark it "unresolvable" rather than guessing "no_answer". Guessing is
          // what buried this outage — an unknown must look unknown.
          const human = hasHumanTurn(turns);
          await finalizeAIConversation({
            conversationId: c.conversationId,
            turns,
            status: human ? "completed" : "failed",
            durationSec: convo?.durationSec ?? undefined,
            terminationReason: human ? "" : "timeout",
            errorCode: convo?.errorCode ?? null,
            errorReason: convo?.errorReason ?? null,
            failureKind: human ? null : "unresolvable",
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
 *
 * NOTE: this is a best-effort UX nicety, NOT the system's guarantee of
 * finalization. It only runs when a human happens to load a page, only sees the
 * viewer's own calls, and only touches CHECK_LIMIT of them. Relying on it as the
 * safety net is what let 6,164 calls sit unfinalized. The real guarantee is
 * reconcileStuckConversations() below, driven by cron.
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

// ─────────────────────────────────────────────────────────────────────────────
// The cron-driven reconciler: the actual guarantee that every call gets finalized.
// ─────────────────────────────────────────────────────────────────────────────

/** Don't touch calls this young — they may still legitimately be ringing. */
const STUCK_GRACE_MS = 10 * 60_000;

export interface DrainResult {
  checked: number;
  finalized: number;
  errors: number;
  /** True when we ran out of time budget with work still queued. */
  moreRemaining: boolean;
}

/** Run `tasks` with at most `limit` in flight at once. */
async function pooled<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

/**
 * Drain the backlog of never-finalized AI calls, oldest first.
 *
 * Unlike the render-driven path this has no per-run item cap and no query window
 * — it pages with a keyset cursor until the backlog is empty or the time budget
 * runs out, so it converges instead of endlessly re-checking the newest few.
 *
 * A call we genuinely cannot resolve is finalized as `unresolvable` with a NULL
 * outcome. It is never guessed into "no_answer": an unknown must look unknown,
 * or we recreate the exact blindness this incident was made of.
 */
export async function reconcileStuckConversations(opts?: {
  budgetMs?: number;
  pageSize?: number;
  concurrency?: number;
}): Promise<DrainResult> {
  const budgetMs = opts?.budgetMs ?? 50_000;
  const pageSize = opts?.pageSize ?? 200;
  const concurrency = opts?.concurrency ?? 6;
  const deadline = Date.now() + budgetMs;

  const out: DrainResult = { checked: 0, finalized: 0, errors: 0, moreRemaining: false };
  if (!isElevenLabsConfigured()) return out;

  let cursor: string | null = null;
  for (;;) {
    if (Date.now() >= deadline) {
      out.moreRemaining = true;
      break;
    }
    const page: { rows: ActiveRef[]; nextCursor: string | null } =
      await listStuckAIConversations({
        olderThanMs: STUCK_GRACE_MS,
        limit: pageSize,
        after: cursor,
      });
    if (page.rows.length === 0) break;

    await pooled(page.rows, concurrency, async (c) => {
      if (Date.now() >= deadline) return;
      out.checked++;
      try {
        const convo = await fetchConversation(c.conversationId);
        const turns = convo?.turns ?? [];
        const human = hasHumanTurn(turns);
        const status = (convo?.status ?? "").toLowerCase();

        // Still genuinely in flight and inside the hard cap — leave it alone.
        const age = Date.now() - c.startedAt;
        if (!convo && age < MAX_AGE_MS) return;
        if (convo && !TERMINAL.has(status) && age < MAX_AGE_MS) return;

        // We can't read it at all and it's past the cap: the truth is unknowable.
        const unresolvable = !convo && age >= MAX_AGE_MS;

        await finalizeAIConversation({
          conversationId: c.conversationId,
          turns,
          status: human ? "completed" : "failed",
          durationSec: convo?.durationSec ?? undefined,
          terminationReason: convo?.terminationReason ?? (unresolvable ? "unreadable" : "timeout"),
          errorCode: convo?.errorCode ?? null,
          errorReason: convo?.errorReason ?? null,
          failureKind: human ? null : unresolvable ? "unresolvable" : undefined,
        });
        out.finalized++;
      } catch {
        out.errors++;
      }
    });

    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return out;
}
