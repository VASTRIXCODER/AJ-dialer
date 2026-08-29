import { describe, expect, it } from "vitest";
import {
  UNAVAILABLE_STOP_RULES,
  ALWAYS_ENFORCED_STOP_RULES,
  resolveStopRules,
  validateDefinition,
  type PlaybookDefinition,
} from "@/lib/orchestration/definition";
import {
  firstTrippedStopRule,
  idempotencyKeyFor,
  waitUntil,
  type StopSnapshot,
} from "@/lib/orchestration/plan";
import { SEED_TEMPLATES } from "@/lib/orchestration/templates";

// ─────────────────────────────────────────────────────────────────────────────
// The playbook contract (P2.1): the validator is the executable form of
// docs/phase-2/playbook-and-orchestration-contracts.md — a drift between the
// two is a bug in one of them, and THESE tests are where it surfaces.
// ─────────────────────────────────────────────────────────────────────────────

const base: PlaybookDefinition = {
  schemaVersion: 1,
  key: "test_playbook",
  name: "Test",
  trigger: { kind: "event", event: "lead.received" },
  steps: [
    {
      id: "s1",
      kind: "create_work_item",
      type: "first_call",
      reason: "test_reason",
      dueInMinutes: 5,
    },
  ],
  stop: { rules: ["contacted"] },
};

describe("validateDefinition — the strict publish gate", () => {
  it("every seed template publishes clean (contract §11)", () => {
    for (const t of SEED_TEMPLATES) {
      const v = validateDefinition(t);
      expect(v.errors, `${t.key}: ${v.errors.join("; ")}`).toEqual([]);
      expect(v.ok).toBe(true);
    }
  });

  it("RESERVED step kinds fail publish — actions are never inert", () => {
    for (const kind of ["send_sms", "place_ai_call", "branch", "wait_for_event"]) {
      const v = validateDefinition({
        ...base,
        steps: [{ id: "x1", kind, reason: "r" } as never],
      });
      expect(v.ok).toBe(false);
      expect(v.errors.join(" ")).toContain("reserved");
    }
  });

  it("an UNKNOWN event name still validates (events are inert until emitted)", () => {
    // …but an event OUTSIDE the vocabulary fails — the vocabulary IS the
    // whitelist; inertness applies to vocabulary events whose emitters
    // haven't shipped (message.received, installed, …).
    expect(
      validateDefinition({
        ...base,
        trigger: { kind: "event", event: "message.received" },
      }).ok,
    ).toBe(true);
    expect(
      validateDefinition({
        ...base,
        trigger: { kind: "event", event: "totally.made.up" },
      }).ok,
    ).toBe(false);
  });

  it("rejects missing stop rules, duplicate step ids, unknown condition keys", () => {
    expect(validateDefinition({ ...base, stop: { rules: [] } }).ok).toBe(false);
    expect(
      validateDefinition({
        ...base,
        steps: [base.steps[0], { ...base.steps[0] }],
      }).ok,
    ).toBe(false);
    expect(
      validateDefinition({
        ...base,
        eligibility: { all: [{ key: "opportunity.shoe_size", cmp: "eq", value: 9 }] },
      }).ok,
    ).toBe(false);
    // lead.* / custom.* prefixes ride the FilterSpec grammar and pass here.
    expect(
      validateDefinition({
        ...base,
        eligibility: { all: [{ key: "lead.state", cmp: "eq", value: "TX" }] },
      }).ok,
    ).toBe(true);
  });

  it("sweep interval is bounded 5–1440 minutes", () => {
    expect(
      validateDefinition({ ...base, trigger: { kind: "sweep", intervalMinutes: 1 } }).ok,
    ).toBe(false);
    expect(
      validateDefinition({ ...base, trigger: { kind: "sweep", intervalMinutes: 15 } }).ok,
    ).toBe(true);
  });
});

describe("resolveStopRules — the always-enforced pair", () => {
  it("dnc_or_opt_out and opportunity_closed ride along whatever the author wrote", () => {
    const rules = resolveStopRules({ stop: { rules: ["contacted"] } });
    for (const r of ALWAYS_ENFORCED_STOP_RULES) expect(rules.has(r)).toBe(true);
    expect(rules.has("contacted")).toBe(true);
    // Unknown junk from a hand-edited blob is dropped, not trusted.
    expect(resolveStopRules({ stop: { rules: ["banana"] } }).size).toBe(2);
  });
});

describe("firstTrippedStopRule — precedence and the max-attempts rail", () => {
  const calm: StopSnapshot = {
    dncOrOptOut: false,
    opportunityClosed: false,
    managerPause: false,
    contacted: false,
    attempted: false,
    replied: false,
    callbackSet: false,
    callbackCompleted: false,
    appointmentBooked: false,
    sold: false,
    complaint: false,
    openIssue: false,
    reassigned: false,
    attemptsSinceActivation: 0,
  };

  it("the always-enforced pair trips even when the rule set omits them", () => {
    const rules = resolveStopRules({ stop: { rules: ["contacted"] } });
    expect(firstTrippedStopRule(rules, { ...calm, dncOrOptOut: true })).toBe(
      "dnc_or_opt_out",
    );
    expect(firstTrippedStopRule(rules, { ...calm, opportunityClosed: true })).toBe(
      "opportunity_closed",
    );
  });

  it("named rules trip only when named; nothing trips on a calm snapshot", () => {
    const rules = resolveStopRules({ stop: { rules: ["attempted"] } });
    expect(firstTrippedStopRule(rules, calm)).toBeNull();
    expect(firstTrippedStopRule(rules, { ...calm, attempted: true })).toBe("attempted");
    // `contacted` isn't in this set — it must NOT stop the playbook.
    expect(firstTrippedStopRule(rules, { ...calm, contacted: true })).toBeNull();
  });

  it("maxAttempts and stopOnReassign are opt-in rails", () => {
    const rules = resolveStopRules({ stop: { rules: ["contacted"] } });
    expect(
      firstTrippedStopRule(rules, { ...calm, attemptsSinceActivation: 4 }, { maxAttempts: 4 }),
    ).toBe("max_attempts");
    expect(
      firstTrippedStopRule(rules, { ...calm, reassigned: true }, { stopOnReassign: true }),
    ).toBe("reassigned");
    expect(firstTrippedStopRule(rules, { ...calm, reassigned: true })).toBeNull();
  });
});

describe("plan helpers — determinism", () => {
  it("idempotency keys are pure string composition", () => {
    expect(idempotencyKeyFor("i1", "s1", "v3")).toBe("i1:s1:v3");
  });

  it("delta waits are exact; sub-minute deltas clamp to one minute", () => {
    const now = new Date("2026-08-26T15:00:00Z");
    const w = waitUntil(
      { id: "w", kind: "wait", for: { hours: 2 } },
      now,
      "America/Chicago",
    );
    expect(w.getTime() - now.getTime()).toBe(2 * 3_600_000);
    const clamped = waitUntil(
      { id: "w", kind: "wait", for: { minutes: 0 } },
      now,
      "America/Chicago",
    );
    expect(clamped.getTime() - now.getTime()).toBe(60_000);
  });

  it("untilLocalTime resolves the NEXT occurrence in the given timezone", () => {
    // 15:00 UTC = 10:00 America/Chicago (CDT). Waiting until 10:00 local when
    // it IS 10:00 rolls to tomorrow; waiting until 11:30 waits 90 minutes.
    const now = new Date("2026-08-26T15:00:00Z");
    const soon = waitUntil(
      { id: "w", kind: "wait", for: { untilLocalTime: "11:30" } },
      now,
      "America/Chicago",
    );
    expect(soon.getTime() - now.getTime()).toBe(90 * 60_000);
    const tomorrow = waitUntil(
      { id: "w", kind: "wait", for: { untilLocalTime: "10:00" } },
      now,
      "America/Chicago",
    );
    expect(tomorrow.getTime() - now.getTime()).toBe(24 * 60 * 60_000);
  });
});

describe("stop rules that cannot fire are refused at publish", () => {
  // A playbook declaring `replied` would advertise a protection the product
  // cannot deliver — nothing emits customer replies. Accepting it silently is
  // the same class of lie as a frequency cap that never applies.
  const base = SEED_TEMPLATES[0];

  for (const rule of Object.keys(UNAVAILABLE_STOP_RULES)) {
    it(`refuses "${rule}" and explains why`, () => {
      const v = validateDefinition({
        ...base,
        key: "probe",
        stop: { rules: [rule, "opportunity_closed"] },
      });
      expect(v.ok).toBe(false);
      const joined = (v.ok ? [] : v.errors).join(" ");
      expect(joined).toContain(rule);
      expect(joined).toContain(UNAVAILABLE_STOP_RULES[rule]);
    });
  }

  it("still accepts the rules that DO have emitters", () => {
    const v = validateDefinition({
      ...base,
      key: "probe_ok",
      stop: {
        rules: ["contacted", "attempted", "callback_completed", "opportunity_closed"],
      },
    });
    expect(v.ok).toBe(true);
  });
});
