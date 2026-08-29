import { describe, expect, it } from "vitest";
import {
  REACTIVATION_COHORTS,
  reactivationCohort,
  reactivationCutoffIso,
  reactivationSummary,
} from "../src/lib/dialer/reactivation";
import { BLOCKED_SEGMENTS, OPT_IN_SEGMENTS, DEFAULT_SEGMENTS } from "../src/lib/dialer/segments";

// ─────────────────────────────────────────────────────────────────────────────
// P2.9: reactivation cohorts are RULES. The invariants that must never drift:
// no cohort may include a blocked status, every status must be a real segment,
// and the cutoff arithmetic is deterministic.
// ─────────────────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-29T18:00:00.000Z");

describe("reactivation cohorts", () => {
  it("no cohort can ever include a blocked (DNC) status", () => {
    const blocked = new Set<string>(BLOCKED_SEGMENTS);
    for (const cohort of REACTIVATION_COHORTS) {
      for (const status of cohort.statuses) {
        expect(blocked.has(status)).toBe(false);
      }
    }
  });

  it("every cohort status is a known segment", () => {
    const known = new Set<string>([...DEFAULT_SEGMENTS, ...OPT_IN_SEGMENTS]);
    for (const cohort of REACTIVATION_COHORTS) {
      for (const status of cohort.statuses) {
        expect(known.has(status)).toBe(true);
      }
    }
  });

  it("cohorts are aged — nothing fresh qualifies", () => {
    for (const cohort of REACTIVATION_COHORTS) {
      expect(cohort.agedDays).toBeGreaterThanOrEqual(30);
    }
  });

  it("cutoff arithmetic is exact", () => {
    const goneQuiet = reactivationCohort("gone_quiet")!;
    expect(reactivationCutoffIso(goneQuiet, NOW)).toBe("2026-07-30T18:00:00.000Z");
    const aged = reactivationCohort("aged_untouched")!;
    expect(reactivationCutoffIso(aged, NOW)).toBe("2026-07-15T18:00:00.000Z");
  });

  it("unknown cohort keys resolve to null, never a default sweep", () => {
    expect(reactivationCohort("all_leads")).toBeNull();
    expect(reactivationCohort("")).toBeNull();
  });

  it("the loaded-session summary names the cohort, the size and the age", () => {
    const c = reactivationCohort("nurture_ripe")!;
    const line = reactivationSummary(c, 42, "homeowners");
    expect(line).toContain("42 homeowners");
    expect(line).toContain("60+ days");
  });

  it("aged_untouched requires never-attempted; the others cap attempts", () => {
    expect(reactivationCohort("aged_untouched")!.maxAttempts).toBe(0);
    expect(reactivationCohort("gone_quiet")!.maxAttempts).toBeGreaterThan(0);
    expect(reactivationCohort("nurture_ripe")!.maxAttempts).toBeGreaterThan(0);
  });
});
