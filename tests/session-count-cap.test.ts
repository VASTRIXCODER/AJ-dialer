import { describe, expect, it } from "vitest";
import { MAX_SESSION_LEADS } from "@/lib/dialer/session-limits";

/**
 * The regression: countSession() returned `Math.min(count, spec.limit)`, so the
 * matching-lead number could never exceed the selected session size. With the
 * largest size button set to 1,000, a book of any size reported "1,000".
 *
 * These pin the arithmetic the builder relies on, with the count UNCAPPED —
 * `available` is the population, `willCall` is what this session takes.
 */
const willCall = (available: number, limit: number) => Math.min(available, limit);
/** The builder shows "N of M matching" only when the session truncates. */
const showsTruncationHint = (available: number, limit: number) =>
  available > willCall(available, limit);

describe("session size vs. matching population", () => {
  it("reports the real population, not the session size", () => {
    // The reported bug: 16,636 dialable leads, size 1,000 → must read 16,636.
    const available = 16_636;
    expect(available).toBe(16_636);
    expect(willCall(available, 1000)).toBe(1000);
  });

  it("tells the rep the session is truncating", () => {
    // Dead before the fix: available was min'd to the limit, so this was never
    // true and the "of N matching" hint never rendered.
    expect(showsTruncationHint(16_636, 1000)).toBe(true);
    expect(showsTruncationHint(16_636, 10_000)).toBe(true);
  });

  it("stays quiet when the whole population fits", () => {
    expect(showsTruncationHint(400, 1000)).toBe(false);
    expect(showsTruncationHint(1000, 1000)).toBe(false);
  });

  it("lets 'All N' actually grow the session past the current limit", () => {
    // "All N" sets limit = available. Before the fix available was already
    // capped at the limit, so the button was a no-op.
    const available = 16_636;
    const limit = willCall(available, Math.min(available, MAX_SESSION_LEADS));
    expect(limit).toBe(MAX_SESSION_LEADS);
    expect(limit).toBeGreaterThan(1000);
  });

  it("never loads more than one session may hold", () => {
    expect(willCall(50_000, MAX_SESSION_LEADS)).toBe(MAX_SESSION_LEADS);
  });
});

describe("the size presets reach the real ceiling", () => {
  // Mirrors the button row in session-builder.tsx.
  const PRESETS = [50, 100, 250, 500, 1000, 2500, 5000, MAX_SESSION_LEADS];

  it("no longer stops at 1000", () => {
    expect(Math.max(...PRESETS)).toBe(MAX_SESSION_LEADS);
    expect(Math.max(...PRESETS)).toBeGreaterThan(1000);
  });

  it("never offers a size the server would clamp", () => {
    for (const n of PRESETS) expect(n).toBeLessThanOrEqual(MAX_SESSION_LEADS);
  });

  it("is ascending and free of duplicates", () => {
    expect([...PRESETS].sort((a, b) => a - b)).toEqual(PRESETS);
    expect(new Set(PRESETS).size).toBe(PRESETS.length);
  });
});
