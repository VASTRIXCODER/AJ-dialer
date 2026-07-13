import "server-only";

import { finalizeAIConversation } from "./ai-call-finalize";
import { applyTwilioCallStatus } from "./ai-call-state";
import {
  getAIConversationsForMonitor,
  listStuckAIConversations,
  listUnconnectedAILegs,
} from "./db/records";
import {
  fetchConversation,
  isAIBridgeConfigured,
  isElevenLabsConfigured,
} from "./elevenlabs";
import { getRestClient, isRestConfigured } from "./twilio";

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

// ─────────────────────────────────────────────────────────────────────────────
// Twilio status poll — the ringing/no-answer signal for DIRECT mode.
//
// In bridge mode we place the homeowner's leg ourselves and Twilio pushes its
// status to /api/twilio/status within a second. In direct mode ElevenLabs places
// that leg, and Twilio's API gives us no way to attach a status callback after the
// fact — so push is simply unavailable.
//
// But the leg is not out of reach: ElevenLabs dials through the org's OWN Twilio
// number, so the call exists in our Twilio account and we can just ask about it.
// That's authoritative and immediate, unlike polling ElevenLabs — which believes a
// call is connected the moment it's placed.
//
// Cost: one Twilio REST fetch (~100ms) per not-yet-connected call, capped. A call
// is only in this set for the few seconds between placement and pickup, so in
// practice this touches almost nothing.
// ─────────────────────────────────────────────────────────────────────────────

const TWILIO_CHECK_LIMIT = 10;

/**
 * Which Twilio leg actually represents the HOMEOWNER's phone?
 *
 * This distinction is load-bearing. In bridge mode `call_sid` is the AGENT's leg —
 * the one dialing our own bridge number, which the voice webhook answers instantly
 * with a <Pause>. Polling that leg would report `in-progress` within a second of
 * every call and mark it "Connected" while the homeowner's phone is still ringing:
 * exactly the lie we just finished tearing out of the personalization webhook.
 *
 * So in bridge mode the homeowner is `customer_call_sid`, and nothing else will
 * do. If the bridge failed and we never got one, we have no homeowner leg to ask
 * about — return null rather than guess with the agent's.
 */
function homeownerLeg(leg: {
  callSid: string | null;
  customerCallSid: string | null;
}): string | null {
  if (isAIBridgeConfigured()) return leg.customerCallSid;
  return leg.customerCallSid ?? leg.callSid;
}

/**
 * Ask Twilio the true state of every active call that hasn't connected yet, and
 * apply it through the same transition table the status webhook uses.
 *
 * Returns the conversations it FINALIZED (Twilio said nobody ever picked up), so
 * a caller that also consults ElevenLabs can skip them. That matters: Twilio's
 * verdict is the precise one — a `failed` leg carrying 21210/21610 is filed as a
 * `provider_error`, whereas ElevenLabs, which cannot see the homeowner's phone at
 * all, would only ever offer a generic timeout. Re-finalizing from the vaguer
 * source would overwrite the better answer with a worse one.
 */
export async function reconcileViaTwilio(
  conversationIds: string[],
): Promise<Set<string>> {
  const settled = new Set<string>();
  if (!isRestConfigured() || conversationIds.length === 0) return settled;

  const legs = (await listUnconnectedAILegs(conversationIds))
    .map((l) => ({ ...l, sid: homeownerLeg(l) }))
    .filter((l): l is typeof l & { sid: string } => Boolean(l.sid))
    .slice(0, TWILIO_CHECK_LIMIT);
  if (legs.length === 0) return settled;

  const client = await getRestClient();
  if (!client) return settled;

  await Promise.all(
    legs.map(async (leg) => {
      try {
        const call = await client.calls(leg.sid).fetch();
        const applied = await applyTwilioCallStatus({
          conversationId: leg.conversationId,
          agentCallSid: leg.callSid,
          callStatus: String(call.status ?? ""),
          // The REST resource exposes the same error code the webhook would carry.
          errorCode: (call as { errorCode?: number | null }).errorCode ?? null,
        });
        if (applied === "unanswered") settled.add(leg.conversationId);
      } catch {
        /* best-effort — the cron drainer is the guarantee, not this */
      }
    }),
  );
  return settled;
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

/**
 * Don't touch calls this young — they may still legitimately be ringing.
 *
 * Was 10 minutes, back when this was imagined as the only safety net. Now that
 * Twilio pushes the real verdict to /api/twilio/status within a second of the
 * homeowner's phone giving up (~33s), a ten-minute grace buys nothing and simply
 * extends how long a call sits stranded when a webhook IS genuinely lost. Two
 * minutes is comfortably past any real ring-out while keeping the backstop tight.
 */
const STUCK_GRACE_MS = 2 * 60_000;

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
  // Twilio alone is enough to resolve a call that never connected, so this runs
  // even with no ElevenLabs key. Only the transcript pass below needs one.
  if (!isElevenLabsConfigured() && !isRestConfigured()) return out;

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

    // Ask Twilio FIRST, because Twilio is the only witness to the homeowner's
    // phone. Without this the cron — the thing this file calls "the actual
    // guarantee" — was the one path that never consulted it: reconcileViaTwilio
    // ran solely inside the supervisor's monitor poll, so an unwatched no-answer
    // waited on ElevenLabs, which believes a call is connected the moment it is
    // placed. In direct mode (no bridge number, hence no status callback) that is
    // the ONLY way a ringing call ever learns it rang out.
    //
    // It also settles calls the ElevenLabs pass below would leave alone: a leg
    // Twilio reports as no-answer/busy/failed is finalized here, and the pass
    // below then finds nothing left to do. Cheap — one REST fetch per
    // not-yet-connected call, internally capped, and a call only sits in that set
    // for the seconds between placement and pickup.
    const settled = await reconcileViaTwilio(page.rows.map((r) => r.conversationId));
    out.checked += settled.size;
    out.finalized += settled.size;

    if (!isElevenLabsConfigured()) {
      cursor = page.nextCursor;
      if (!cursor) break;
      continue;
    }

    await pooled(page.rows, concurrency, async (c) => {
      if (Date.now() >= deadline) return;
      // Twilio already gave this one a verdict, and a better one than ElevenLabs
      // can. Don't spend a lookup re-deciding it.
      if (settled.has(c.conversationId)) return;
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
