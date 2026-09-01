// ─────────────────────────────────────────────────────────────────────────────
// Placing one outbound leg, surviving a transient provider failure.
//
// calls.create() had no retry at all: one blip from Twilio and the leg came back
// with no SID, the dial was abandoned, and the rep got the SDK's raw
// "[HTTP 502] Failed to execute request" in red with nothing to do but dial
// again by hand. A momentary 502 on Twilio's side should not cost a dial.
//
// Retrying a call-create is NOT automatically safe. A 502 can mean "we handled
// your request and lost the response", so a blind retry can ring a homeowner
// TWICE — the one outcome worse than a failed dial. Every retry here is
// therefore preceded by asking Twilio whether a leg to this number already
// exists; if one does we adopt it instead of dialing again. That's the same
// recovery the dialer already performs client-side when nothing comes back
// (findRecentLegs), moved earlier so it can prevent a duplicate rather than
// just explain one.
//
// The retry logic is injectable end-to-end so it can be tested without Twilio.
// ─────────────────────────────────────────────────────────────────────────────

/** Delays before the 2nd and 3rd attempts. Deliberately short — a rep is
 *  watching this happen, and a dial that takes seconds to start reads as broken
 *  even when it eventually works. */
export const RETRY_DELAYS_MS = [250, 600];

/**
 * Is this failure worth retrying?
 *
 * Retry only what a retry can fix: the provider being briefly unavailable, or
 * the request never completing. A 4xx is a real rejection — an unverified
 * number, a caller ID that isn't on the account, a geographic permission — and
 * retrying it just delays an error the team needs to see and act on.
 */
export function isTransientProviderError(err: unknown): boolean {
  const e = err as { status?: unknown; code?: unknown; message?: unknown } | null;
  // Only trust `status` when it's actually an HTTP status. Twilio error CODES
  // (21210, 13224, …) are five-digit numbers that would sail past a naive
  // `>= 500` and turn a permanent rejection into a retry loop.
  const raw = e?.status;
  const status = typeof raw === "number" && raw >= 100 && raw <= 599 ? raw : null;
  if (status !== null) return status >= 500 || status === 429;
  const msg = String(e?.message ?? err ?? "");
  return /\[HTTP (5\d\d|429)\]|Failed to execute request|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network error|timed? ?out/i.test(
    msg,
  );
}

/**
 * Turn a provider failure into something a rep can act on.
 *
 * Permanent rejections keep Twilio's own wording — that's deliberate, and the
 * reason the raw message was surfaced in the first place: "unverified number"
 * or "caller ID not on this account" tells the team exactly what to fix. A
 * transient one says nothing useful to anybody, so it gets replaced with what
 * actually happened and what to do about it.
 */
export function describeDialFailure(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (!isTransientProviderError(err)) return raw;
  const status = (err as { status?: unknown })?.status;
  const code = typeof status === "number" ? ` (HTTP ${status})` : "";
  return `Twilio didn't respond${code} — the call was not placed. Try again.`;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PlaceLegResult {
  sid: string | null;
  error: string | null;
  /** How many create attempts were actually made. */
  attempts: number;
  /** True when a retry was skipped because the call already existed — the
   *  double-dial that didn't happen. */
  adopted: boolean;
}

/**
 * Create one outbound leg, retrying transient provider failures.
 *
 * `findExisting` is the double-dial guard: it must answer "is there already a
 * live/recent call to this number?" Omit it and NO retry is attempted, because
 * without that answer a retry cannot be proven safe.
 */
export async function placeLegWithRetry({
  createCall,
  findExisting,
  delaysMs = RETRY_DELAYS_MS,
  sleep = wait,
}: {
  createCall: () => Promise<{ sid: string }>;
  findExisting?: () => Promise<{ sid: string } | null>;
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}): Promise<PlaceLegResult> {
  // Without a way to check for a duplicate, one attempt is all that's safe.
  const maxAttempts = findExisting ? delaysMs.length + 1 : 1;
  let lastErr: unknown = null;
  let made = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    made = attempt;
    try {
      const call = await createCall();
      return { sid: call.sid, error: null, attempts: attempt, adopted: false };
    } catch (err) {
      lastErr = err;
      if (!isTransientProviderError(err) || attempt === maxAttempts) break;

      // Before dialing again: did the attempt that "failed" actually reach
      // Twilio? If a leg exists, the 502 was a lost response, not a lost call.
      try {
        const existing = await findExisting!();
        if (existing?.sid) {
          return { sid: existing.sid, error: null, attempts: attempt, adopted: true };
        }
      } catch {
        // The duplicate check itself failed, so we cannot prove a retry is
        // safe. Stop here: a failed dial is recoverable, a homeowner rung
        // twice is not.
        break;
      }

      await sleep(delaysMs[attempt - 1] ?? 0);
    }
  }

  return { sid: null, error: describeDialFailure(lastErr), attempts: made, adopted: false };
}
