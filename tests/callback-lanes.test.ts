import { describe, expect, it } from "vitest";
import {
  AMBER_AFTER_MS,
  CLAIM_STALE_MS,
  compareCallbacks,
  DUE_WINDOW_MS,
  dueAtMs,
  isClaimActive,
  laneOf,
  MISSED_AFTER_MS,
  overdueTier,
  type SortableCallback,
} from "@/lib/callbacks/lanes";

// ─────────────────────────────────────────────────────────────────────────────
// Lane + escalation derivation at a FIXED clock. due_at is a floating
// wall-clock string (no offset) parsed in the local zone, so the fixture clock
// is built the same way — the tests hold in any TZ the runner executes in.
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed local wall-clock "now": 2026-08-28 12:00:00 local. */
const NOW = new Date(2026, 7, 28, 12, 0, 0, 0).getTime();

/** Floating string `m` minutes from NOW (negative = past). */
const floating = (minutesFromNow: number): string => {
  const d = new Date(NOW + minutesFromNow * 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
};

describe("laneOf", () => {
  it("a callback with no agreed time is due now — not upcoming, not overdue", () => {
    expect(laneOf(null, NOW)).toBe("due");
    expect(laneOf("", NOW)).toBe("due");
    expect(laneOf("not a date at all", NOW)).toBe("due");
  });

  it("±1 minute around the agreed time still reads as due", () => {
    expect(laneOf(floating(0), NOW)).toBe("due");
    // 59s past / ahead — inside the window.
    expect(laneOf(floating(-59 / 60), NOW)).toBe("due");
    expect(laneOf(floating(59 / 60), NOW)).toBe("due");
  });

  it("past the window it's overdue; ahead of it it's upcoming", () => {
    expect(laneOf(floating(-2), NOW)).toBe("overdue");
    expect(laneOf(floating(2), NOW)).toBe("upcoming");
    expect(laneOf(floating(60 * 24 * 7), NOW)).toBe("upcoming");
  });

  it("parses floating wall-clock strings without offset shifting", () => {
    // The exact minute must round-trip: dueAtMs(floating(x)) === NOW + x min.
    expect(dueAtMs(floating(-90))).toBe(NOW - 90 * 60_000);
    expect(DUE_WINDOW_MS).toBe(60_000);
  });
});

describe("overdueTier — escalation is derived, never stored", () => {
  it("null for anything that isn't overdue", () => {
    expect(overdueTier(null, NOW)).toBeNull();
    expect(overdueTier(floating(0), NOW)).toBeNull();
    expect(overdueTier(floating(30), NOW)).toBeNull();
  });

  it("grace ≤ 2h late, amber > 2h, missed > 24h", () => {
    expect(overdueTier(floating(-5), NOW)).toBe("grace");
    expect(overdueTier(floating(-119), NOW)).toBe("grace");
    expect(overdueTier(floating(-121), NOW)).toBe("amber");
    expect(overdueTier(floating(-60 * 23), NOW)).toBe("amber");
    expect(overdueTier(floating(-60 * 25), NOW)).toBe("missed");
    expect(overdueTier(floating(-60 * 24 * 5), NOW)).toBe("missed");
  });

  it("tier thresholds match the documented constants", () => {
    expect(AMBER_AFTER_MS).toBe(2 * 60 * 60 * 1000);
    expect(MISSED_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("isClaimActive — LOCKSTEP with app_claim_callback (supabase/schema.sql)", () => {
  // The RPC grants a takeover once claimed_at < now() - interval '15 minutes'.
  // This predicate must mirror that EXACTLY: a claim the RPC would still
  // defend shows as active; one it would hand over shows as free.
  const iso = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();

  it("no claimant (or no stamp) is never active", () => {
    expect(isClaimActive(null, null, NOW)).toBe(false);
    expect(isClaimActive("user-1", null, NOW)).toBe(false);
    expect(isClaimActive(null, iso(1), NOW)).toBe(false);
    expect(isClaimActive("user-1", "garbage", NOW)).toBe(false);
  });

  it("a fresh claim is active; a 15-minute-stale one is up for grabs", () => {
    expect(isClaimActive("user-1", iso(1), NOW)).toBe(true);
    expect(isClaimActive("user-1", iso(14), NOW)).toBe(true);
    expect(isClaimActive("user-1", iso(16), NOW)).toBe(false);
    expect(CLAIM_STALE_MS).toBe(15 * 60_000);
  });
});

describe("compareCallbacks — in-lane ordering", () => {
  const row = (
    priority: number,
    dueAt: string | null,
    createdAt = new Date(NOW - 86_400_000).toISOString(),
  ): SortableCallback => ({ priority, dueAt, createdAt });

  it("flagged rows come first regardless of time", () => {
    const flagged = row(1, floating(60));
    const soon = row(0, floating(-600));
    expect([soon, flagged].sort(compareCallbacks)[0]).toBe(flagged);
  });

  it("then soonest/oldest due first — most overdue on top, next due on top", () => {
    const veryLate = row(0, floating(-600));
    const justLate = row(0, floating(-5));
    const soonest = row(0, floating(10));
    const later = row(0, floating(120));
    expect([later, justLate, soonest, veryLate].sort(compareCallbacks)).toEqual([
      veryLate,
      justLate,
      soonest,
      later,
    ]);
  });

  it("timeless rows sort after timed ones; oldest promise breaks the tie", () => {
    const timed = row(0, floating(30));
    const oldNoTime = row(0, null, new Date(NOW - 3 * 86_400_000).toISOString());
    const newNoTime = row(0, null, new Date(NOW - 1 * 86_400_000).toISOString());
    expect([newNoTime, oldNoTime, timed].sort(compareCallbacks)).toEqual([
      timed,
      oldNoTime,
      newNoTime,
    ]);
  });
});
