import { describe, expect, it } from "vitest";
import { BACKOFF_MIN, MAX_ATTEMPTS, nextAttemptDelayMs } from "@/lib/notifications/backoff";

describe("notification backoff ladder", () => {
  it("returns the configured minute delays in ms", () => {
    expect(nextAttemptDelayMs(1)).toBe(BACKOFF_MIN[0] * 60_000);
    expect(nextAttemptDelayMs(2)).toBe(BACKOFF_MIN[1] * 60_000);
    expect(nextAttemptDelayMs(4)).toBe(BACKOFF_MIN[3] * 60_000);
  });

  it("TERMINATES — the property the whole feature depends on", () => {
    // Every attempt eventually returns null, so the retry loop can never run
    // forever and the failure alert always fires.
    expect(nextAttemptDelayMs(MAX_ATTEMPTS)).toBeNull();
    expect(nextAttemptDelayMs(MAX_ATTEMPTS + 1)).toBeNull();
    expect(nextAttemptDelayMs(100)).toBeNull();

    let attempts = 1;
    let steps = 0;
    while (nextAttemptDelayMs(attempts) !== null) {
      attempts++;
      if (++steps > MAX_ATTEMPTS + 5) throw new Error("backoff never terminated");
    }
    expect(attempts).toBe(MAX_ATTEMPTS);
  });
});
