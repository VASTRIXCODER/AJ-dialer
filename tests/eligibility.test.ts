import { describe, expect, it } from "vitest";
import type { AutomationSettings } from "@/lib/org/settings";
import {
  compareDialOrder,
  evaluateEligibility,
  leadSnapshotDigits,
  type EligibilityContext,
  type LeadSnapshot,
} from "@/lib/dialer/eligibility";

// 2026-08-12 15:30 UTC → 10:30 in America/Chicago (CDT), 08:30 in Los Angeles.
const NOW = new Date("2026-08-12T15:30:00Z");

const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();
const minutesAhead = (m: number): string => new Date(NOW.getTime() + m * 60_000).toISOString();

function window(overrides: Partial<AutomationSettings> = {}): AutomationSettings {
  return {
    enabled: true,
    timezone: "America/Chicago",
    days: [0, 1, 2, 3, 4, 5, 6],
    windows: [{ start: 10, end: 11 }], // 10:30 Chicago is inside; 08:30 LA is not
    callsPerRun: 3,
    dailyCap: 0,
    cooldownHours: 6,
    ...overrides,
  };
}

function lead(overrides: Partial<LeadSnapshot & { createdAt?: string }> = {}): LeadSnapshot & {
  createdAt?: string;
} {
  return {
    id: "lead-1",
    orgId: "org-1",
    ownerId: "rep-1",
    assignedRepId: null,
    status: "new",
    phoneDigits: "5595551234",
    timezone: "America/Chicago",
    attemptCount: 0,
    lastAttemptAt: null,
    nextEligibleAt: null,
    reservedBy: null,
    reservedUntil: null,
    campaignId: null,
    leadPackId: null,
    ...overrides,
  };
}

function ctx(overrides: {
  policy?: Partial<EligibilityContext["policy"]>;
  actor?: Partial<EligibilityContext["actor"]>;
  isDnc?: EligibilityContext["isDnc"];
  activeCallLeadIds?: ReadonlySet<string>;
  dueCallbackLeadIds?: ReadonlySet<string>;
} = {}): EligibilityContext {
  return {
    now: NOW,
    actor: { userId: "rep-1", orgId: "org-1", supervisor: false, ...overrides.actor },
    mode: "manual",
    policy: {
      statuses: ["new", "no_answer", "callback"],
      cooldownMinutes: 0,
      maxAttempts: 0,
      window: null,
      ...overrides.policy,
    },
    isDnc: overrides.isDnc ?? (() => false),
    activeCallLeadIds: overrides.activeCallLeadIds,
    dueCallbackLeadIds: overrides.dueCallbackLeadIds,
  };
}

describe("evaluateEligibility — one reason per rule", () => {
  it("passes a clean lead", () => {
    expect(evaluateEligibility(lead(), ctx())).toEqual({ eligible: true, reasons: [] });
  });

  it("wrong_org for a lead in another org (org-less legacy rows pass)", () => {
    expect(evaluateEligibility(lead({ orgId: "org-2" }), ctx()).reasons).toContain("wrong_org");
    expect(evaluateEligibility(lead({ orgId: null }), ctx()).eligible).toBe(true);
  });

  it("not_assigned unless the actor owns or is assigned the lead", () => {
    const other = lead({ ownerId: "rep-2", assignedRepId: null });
    expect(evaluateEligibility(other, ctx()).reasons).toContain("not_assigned");
    // Assignment counts even when someone else owns the row.
    expect(
      evaluateEligibility(lead({ ownerId: "rep-2", assignedRepId: "rep-1" }), ctx()).eligible,
    ).toBe(true);
  });

  it("supervisors bypass not_assigned", () => {
    const other = lead({ ownerId: "rep-2", assignedRepId: "rep-3" });
    expect(evaluateEligibility(other, ctx({ actor: { supervisor: true } })).eligible).toBe(true);
  });

  it("blocked_status for dnc even when the policy explicitly selects it", () => {
    const result = evaluateEligibility(
      lead({ status: "dnc" }),
      ctx({ policy: { statuses: ["dnc", "new"] } }),
    );
    expect(result.reasons).toContain("blocked_status");
  });

  it("status_not_selected when the status isn't in the policy", () => {
    expect(evaluateEligibility(lead({ status: "contacted" }), ctx()).reasons).toEqual([
      "status_not_selected",
    ]);
  });

  it("invalid_phone under 10 digits, tolerating formatting characters", () => {
    expect(evaluateEligibility(lead({ phoneDigits: "555123" }), ctx()).reasons).toContain(
      "invalid_phone",
    );
    expect(evaluateEligibility(lead({ phoneDigits: "(559) 555-1234" }), ctx()).eligible).toBe(true);
  });

  it("dnc matches on the LAST TEN digits regardless of country code", () => {
    const dncCtx = ctx({ isDnc: (last10) => last10 === "5595551234" });
    expect(evaluateEligibility(lead({ phoneDigits: "15595551234" }), dncCtx).reasons).toEqual([
      "dnc",
    ]);
  });

  it("outside_window uses the LEAD's own timezone, not the org's", () => {
    const policy = { window: window() };
    // 10:30 in Chicago — inside the 10–11 window.
    expect(evaluateEligibility(lead(), ctx({ policy })).eligible).toBe(true);
    // Same instant is 08:30 in Los Angeles — outside.
    expect(
      evaluateEligibility(lead({ timezone: "America/Los_Angeles" }), ctx({ policy })).reasons,
    ).toEqual(["outside_window"]);
  });

  it("reserved_elsewhere only while someone ELSE's reservation is live", () => {
    const live = lead({ reservedBy: "rep-2", reservedUntil: minutesAhead(5) });
    expect(evaluateEligibility(live, ctx()).reasons).toEqual(["reserved_elsewhere"]);
    // Expired reservation ⇒ eligible.
    const expired = lead({ reservedBy: "rep-2", reservedUntil: minutesAgo(1) });
    expect(evaluateEligibility(expired, ctx()).eligible).toBe(true);
    // Your own reservation ⇒ eligible.
    const mine = lead({ reservedBy: "rep-1", reservedUntil: minutesAhead(5) });
    expect(evaluateEligibility(mine, ctx()).eligible).toBe(true);
  });

  it("active_call when the lead already has a live leg", () => {
    const result = evaluateEligibility(
      lead(),
      ctx({ activeCallLeadIds: new Set(["lead-1"]) }),
    );
    expect(result.reasons).toEqual(["active_call"]);
  });

  it("max_attempts at the boundary; 0 means unlimited", () => {
    const tried = lead({ attemptCount: 3, lastAttemptAt: minutesAgo(999) });
    expect(
      evaluateEligibility(tried, ctx({ policy: { maxAttempts: 3 } })).reasons,
    ).toEqual(["max_attempts"]);
    expect(evaluateEligibility(tried, ctx({ policy: { maxAttempts: 4 } })).eligible).toBe(true);
    expect(
      evaluateEligibility(lead({ attemptCount: 500, lastAttemptAt: minutesAgo(999) }), ctx()).eligible,
    ).toBe(true);
  });

  it("cooldown blocks inside the window and releases at the exact boundary", () => {
    const policy = { cooldownMinutes: 30 };
    expect(
      evaluateEligibility(lead({ attemptCount: 1, lastAttemptAt: minutesAgo(29) }), ctx({ policy }))
        .reasons,
    ).toEqual(["cooldown"]);
    // Exactly 30 minutes ago — the comparison is strict, so the lead is free.
    expect(
      evaluateEligibility(lead({ attemptCount: 1, lastAttemptAt: minutesAgo(30) }), ctx({ policy }))
        .eligible,
    ).toBe(true);
  });

  it("not_yet_eligible while nextEligibleAt is in the future", () => {
    expect(
      evaluateEligibility(lead({ nextEligibleAt: minutesAhead(10) }), ctx()).reasons,
    ).toEqual(["not_yet_eligible"]);
    expect(evaluateEligibility(lead({ nextEligibleAt: minutesAgo(1) }), ctx()).eligible).toBe(true);
  });

  it("wrong_campaign / wrong_pack when the policy pins one and the lead differs", () => {
    expect(
      evaluateEligibility(lead({ campaignId: "c2" }), ctx({ policy: { campaignId: "c1" } })).reasons,
    ).toEqual(["wrong_campaign"]);
    expect(
      evaluateEligibility(lead({ leadPackId: null }), ctx({ policy: { packId: "p1" } })).reasons,
    ).toEqual(["wrong_pack"]);
    // Unpinned policy doesn't care what the lead belongs to.
    expect(
      evaluateEligibility(lead({ campaignId: "c2", leadPackId: "p2" }), ctx()).eligible,
    ).toBe(true);
  });
});

describe("evaluateEligibility — due-callback bypasses", () => {
  const due = { dueCallbackLeadIds: new Set(["lead-1"]) };

  it("bypasses cooldown, max_attempts, and not_yet_eligible together", () => {
    const throttled = lead({
      status: "callback",
      attemptCount: 5,
      lastAttemptAt: minutesAgo(1),
      nextEligibleAt: minutesAhead(60),
    });
    const policy = { cooldownMinutes: 30, maxAttempts: 3 };
    expect(evaluateEligibility(throttled, ctx({ policy })).reasons).toEqual([
      "max_attempts",
      "cooldown",
      "not_yet_eligible",
    ]);
    expect(evaluateEligibility(throttled, ctx({ policy, ...due })).eligible).toBe(true);
  });

  it("NEVER bypasses dnc, blocked_status, or outside_window", () => {
    const blocked = evaluateEligibility(
      lead({ status: "dnc" }),
      ctx({ ...due, isDnc: () => true, policy: { window: window(), statuses: ["dnc"] } }),
    );
    expect(blocked.reasons).toContain("blocked_status");
    expect(blocked.reasons).toContain("dnc");

    const late = evaluateEligibility(
      lead({ status: "callback", timezone: "America/Los_Angeles" }),
      ctx({ ...due, policy: { window: window() } }),
    );
    expect(late.reasons).toEqual(["outside_window"]);
  });
});

describe("evaluateEligibility — reasons accumulate", () => {
  it("reports every failing rule, not just the first", () => {
    const result = evaluateEligibility(
      lead({
        orgId: "org-2",
        ownerId: "rep-2",
        status: "not_interested",
        phoneDigits: "123",
        reservedBy: "rep-2",
        reservedUntil: minutesAhead(5),
      }),
      ctx({ activeCallLeadIds: new Set(["lead-1"]) }),
    );
    expect(result.eligible).toBe(false);
    expect(result.reasons).toEqual([
      "wrong_org",
      "not_assigned",
      "status_not_selected",
      "invalid_phone",
      "reserved_elsewhere",
      "active_call",
    ]);
  });
});

describe("compareDialOrder", () => {
  it("puts never-dialed strictly first, even when created later", () => {
    const fresh = lead({ id: "b", createdAt: "2026-08-10T00:00:00Z" });
    const tried = lead({
      id: "a",
      attemptCount: 2,
      lastAttemptAt: minutesAgo(9999),
      createdAt: "2026-01-01T00:00:00Z",
    });
    expect([tried, fresh].sort(compareDialOrder).map((l) => l.id)).toEqual(["b", "a"]);
  });

  it("orders attempted leads least-recently-attempted first, nulls first", () => {
    const older = lead({ id: "a", attemptCount: 1, lastAttemptAt: minutesAgo(120) });
    const newer = lead({ id: "b", attemptCount: 1, lastAttemptAt: minutesAgo(10) });
    // attemptCount > 0 with a null stamp isn't "never dialed" — it sorts as a null timestamp, first.
    const stampless = lead({ id: "c", attemptCount: 1, lastAttemptAt: null });
    expect([newer, older, stampless].sort(compareDialOrder).map((l) => l.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  it("falls back to createdAt ascending, then id for a stable tie-break", () => {
    const early = lead({ id: "z", createdAt: "2026-01-01T00:00:00Z" });
    const late = lead({ id: "a", createdAt: "2026-02-01T00:00:00Z" });
    expect([late, early].sort(compareDialOrder).map((l) => l.id)).toEqual(["z", "a"]);

    const tie1 = lead({ id: "a", createdAt: "2026-01-01T00:00:00Z" });
    const tie2 = lead({ id: "b", createdAt: "2026-01-01T00:00:00Z" });
    expect([tie2, tie1].sort(compareDialOrder).map((l) => l.id)).toEqual(["a", "b"]);
    expect(compareDialOrder(tie1, tie1)).toBe(0);
  });
});

describe("leadSnapshotDigits", () => {
  it("strips everything but digits", () => {
    expect(leadSnapshotDigits("+1 (559) 555-1234")).toBe("15595551234");
    expect(leadSnapshotDigits("no digits")).toBe("");
  });
});
