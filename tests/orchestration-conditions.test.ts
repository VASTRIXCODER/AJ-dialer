import { describe, expect, it } from "vitest";
import { evaluateConditions, type ConditionContext } from "@/lib/orchestration/conditions";
import type { ConditionGroup } from "@/lib/orchestration/definition";

// ─────────────────────────────────────────────────────────────────────────────
// The condition evaluator (P2.2) — the runtime half of the playbook grammar.
// FilterSpec's discipline is under test: null-as-"" text, numeric-cmp-over-
// junk matches nothing, unknown keys match nothing.
// ─────────────────────────────────────────────────────────────────────────────

const now = new Date("2026-08-29T12:00:00Z");
const ctx: ConditionContext = {
  opportunity: {
    stage: "attempting",
    attempt_count: 3,
    priority: 10,
    last_touched_at: "2026-08-27T12:00:00Z", // 2 days ago
  },
  lead: {
    state: "TX",
    dnc: false,
    phone_valid: true,
    custom: { roof_type: "tile" },
  },
  derived: { callback_overdue_minutes: 45 },
  touch: { outcome: "no_answer", channel: "manual_call" },
};

const all = (
  items: Extract<ConditionGroup, { all: unknown }>["all"],
): ConditionGroup => ({ all: items });

describe("evaluateConditions — comparators", () => {
  it("text eq/neq/in are case-insensitive and null-as-empty", () => {
    expect(evaluateConditions(all([{ key: "lead.state", cmp: "eq", value: "tx" }]), ctx, now)).toBe(true);
    expect(evaluateConditions(all([{ key: "lead.state", cmp: "neq", value: "CA" }]), ctx, now)).toBe(true);
    expect(
      evaluateConditions(
        all([{ key: "opportunity.stage", cmp: "in", value: ["new", "ATTEMPTING"] }]),
        ctx,
        now,
      ),
    ).toBe(true);
    // Absent value reads as "" — is_empty sees it, eq "" matches it.
    expect(evaluateConditions(all([{ key: "lead.city", cmp: "is_empty" }]), ctx, now)).toBe(true);
    expect(evaluateConditions(all([{ key: "lead.city", cmp: "eq", value: "" }]), ctx, now)).toBe(true);
  });

  it("numeric comparators over non-numeric values match NOTHING", () => {
    expect(
      evaluateConditions(all([{ key: "opportunity.stage", cmp: "gt", value: 1 }]), ctx, now),
    ).toBe(false);
    expect(
      evaluateConditions(all([{ key: "opportunity.attempt_count", cmp: "lt", value: 6 }]), ctx, now),
    ).toBe(true);
    expect(
      evaluateConditions(
        all([{ key: "derived.callback_overdue_minutes", cmp: "gte", value: 10 }]),
        ctx,
        now,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        all([{ key: "opportunity.priority", cmp: "between", value: [5, 20] }]),
        ctx,
        now,
      ),
    ).toBe(true);
  });

  it("time comparators use the provided clock", () => {
    expect(
      evaluateConditions(
        all([{ key: "opportunity.last_touched_at", cmp: "within_days", value: 3 }]),
        ctx,
        now,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        all([{ key: "opportunity.last_touched_at", cmp: "older_than_days", value: 1 }]),
        ctx,
        now,
      ),
    ).toBe(true);
    expect(
      evaluateConditions(
        all([{ key: "opportunity.last_touched_at", cmp: "older_than_days", value: 30 }]),
        ctx,
        now,
      ),
    ).toBe(false);
  });

  it("booleans, custom fields, and touch context resolve", () => {
    expect(evaluateConditions(all([{ key: "lead.dnc", cmp: "is_false" }]), ctx, now)).toBe(true);
    expect(evaluateConditions(all([{ key: "lead.phone_valid", cmp: "is_true" }]), ctx, now)).toBe(true);
    expect(
      evaluateConditions(all([{ key: "custom.roof_type", cmp: "eq", value: "Tile" }]), ctx, now),
    ).toBe(true);
    expect(
      evaluateConditions(all([{ key: "lead.custom.roof_type", cmp: "eq", value: "tile" }]), ctx, now),
    ).toBe(true);
    expect(
      evaluateConditions(
        all([{ key: "touch.outcome", cmp: "in", value: ["no_answer", "busy", "voicemail"] }]),
        ctx,
        now,
      ),
    ).toBe(true);
  });

  it("unknown keys and unknown comparators match NOTHING", () => {
    expect(evaluateConditions(all([{ key: "opportunity.shoe_size", cmp: "eq", value: 9 }]), ctx, now)).toBe(false);
    expect(evaluateConditions(all([{ key: "nonsense", cmp: "eq", value: 1 }]), ctx, now)).toBe(false);
    expect(
      evaluateConditions(all([{ key: "lead.state", cmp: "regex" as never, value: ".*" }]), ctx, now),
    ).toBe(false);
  });
});

describe("evaluateConditions — group semantics", () => {
  it("all/any nest; empty all passes, empty any fails; absent group passes", () => {
    expect(evaluateConditions(undefined, ctx, now)).toBe(true);
    expect(evaluateConditions({ all: [] }, ctx, now)).toBe(true);
    expect(evaluateConditions({ any: [] }, ctx, now)).toBe(false);
    expect(
      evaluateConditions(
        {
          all: [
            { key: "lead.dnc", cmp: "is_false" },
            {
              any: [
                { key: "lead.state", cmp: "eq", value: "CA" },
                { key: "opportunity.attempt_count", cmp: "gte", value: 3 },
              ],
            },
          ],
        },
        ctx,
        now,
      ),
    ).toBe(true);
  });
});
