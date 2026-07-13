// The retry ladder for a notification that failed to send. PURE, so the one
// property that actually matters — that it TERMINATES — can be asserted directly.
//
// A retry loop with no end never raises the alert, and "never fails silently" is
// the entire promise of this feature. Five tries over ~7 hours: fast enough that
// a blip is invisible, patient enough to ride out a provider outage, and finite
// so a genuinely broken config reaches a human instead of retrying forever.

export const BACKOFF_MIN = [1, 5, 15, 60, 360];
export const MAX_ATTEMPTS = BACKOFF_MIN.length;

/** How long before attempt `attempts` (1-based) is retried — null when spent. */
export function nextAttemptDelayMs(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  return BACKOFF_MIN[attempts - 1] * 60_000;
}
