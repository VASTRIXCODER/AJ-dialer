// ─────────────────────────────────────────────────────────────────────────────
// Condition evaluation — PURE (no I/O), the runtime half of the grammar the
// definition validator admits (docs/phase-2/playbook-and-orchestration-
// contracts.md §5). The engine assembles a ConditionContext snapshot per
// candidate; this module only judges it.
//
// FilterSpec's evaluation discipline applies verbatim:
//   • text compares treat null as "" (case-insensitive eq/contains);
//   • a numeric comparator over a non-numeric value matches NOTHING;
//   • unknown keys match NOTHING (the validator rejects them at publish, but a
//     definition stored before a key was retired must degrade, not throw).
// ─────────────────────────────────────────────────────────────────────────────

import type { Condition, ConditionGroup } from "./definition";

/** Everything a condition may look at, namespaced exactly like the grammar. */
export interface ConditionContext {
  opportunity?: Record<string, unknown> | null;
  lead?: Record<string, unknown> | null;
  derived?: Record<string, unknown> | null;
  /** Event-trigger filters only: the touch that fired the event. */
  touch?: Record<string, unknown> | null;
}

function resolveKey(ctx: ConditionContext, key: string): unknown {
  const dot = key.indexOf(".");
  if (dot <= 0) return undefined;
  const ns = key.slice(0, dot);
  const field = key.slice(dot + 1);
  switch (ns) {
    case "opportunity":
      return ctx.opportunity?.[field];
    case "lead":
      // `lead.custom.<key>` digs into the lead's custom-fields bag.
      if (field.startsWith("custom.")) {
        const bag = ctx.lead?.custom as Record<string, unknown> | undefined;
        return bag?.[field.slice("custom.".length)];
      }
      return ctx.lead?.[field];
    case "custom": {
      const bag = ctx.lead?.custom as Record<string, unknown> | undefined;
      return bag?.[field];
    }
    case "derived":
      return ctx.derived?.[field];
    case "touch":
      return ctx.touch?.[field];
    default:
      return undefined;
  }
}

const asText = (v: unknown): string => (v == null ? "" : String(v)).toLowerCase();

function asNumber(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Timestamps arrive as ISO strings or epoch ms; anything else is not a date. */
function asTime(v: unknown): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : null;
}

function evalCondition(cond: Condition, ctx: ConditionContext, now: Date): boolean {
  const value = resolveKey(ctx, String(cond.key ?? ""));
  const want = cond.value;
  switch (cond.cmp) {
    case "eq":
      return asText(value) === asText(want);
    case "neq":
      return asText(value) !== asText(want);
    case "in":
      return Array.isArray(want) && want.some((w) => asText(w) === asText(value));
    case "not_in":
      return Array.isArray(want) && !want.some((w) => asText(w) === asText(value));
    case "contains":
      if (Array.isArray(value)) return value.some((v) => asText(v) === asText(want));
      return asText(value).includes(asText(want));
    case "gt": {
      const [a, b] = [asNumber(value), asNumber(want)];
      return a != null && b != null && a > b;
    }
    case "gte": {
      const [a, b] = [asNumber(value), asNumber(want)];
      return a != null && b != null && a >= b;
    }
    case "lt": {
      const [a, b] = [asNumber(value), asNumber(want)];
      return a != null && b != null && a < b;
    }
    case "lte": {
      const [a, b] = [asNumber(value), asNumber(want)];
      return a != null && b != null && a <= b;
    }
    case "between": {
      const a = asNumber(value);
      const lo = asNumber(Array.isArray(want) ? want[0] : undefined);
      const hi = asNumber(Array.isArray(want) ? want[1] : undefined);
      return a != null && lo != null && hi != null && a >= lo && a <= hi;
    }
    case "within_days": {
      const t = asTime(value);
      const days = asNumber(want);
      if (t == null || days == null) return false;
      return now.getTime() - t <= days * 86_400_000 && t <= now.getTime();
    }
    case "older_than_days": {
      const t = asTime(value);
      const days = asNumber(want);
      if (t == null || days == null) return false;
      return now.getTime() - t > days * 86_400_000;
    }
    case "is_true":
      return value === true || value === "true" || value === 1;
    case "is_false":
      return value === false || value === "false" || value === 0 || value == null;
    case "is_set":
      return value != null && String(value).trim() !== "";
    case "is_empty":
      return value == null || String(value).trim() === "";
    default:
      return false;
  }
}

/**
 * Evaluate a group against a context. An ABSENT group passes (a playbook with
 * no eligibility runs for every trigger match); an empty all/any list passes
 * for `all` (vacuous truth) and FAILS for `any` — mirroring FilterSpec.
 */
export function evaluateConditions(
  group: ConditionGroup | null | undefined,
  ctx: ConditionContext,
  now: Date = new Date(),
): boolean {
  if (!group || typeof group !== "object") return true;
  const g = group as { all?: unknown[]; any?: unknown[] };
  const items = (g.all ?? g.any ?? []) as (Condition | ConditionGroup)[];
  const isAll = Array.isArray(g.all);
  if (!Array.isArray(items)) return true;
  if (items.length === 0) return isAll;
  const judge = (item: Condition | ConditionGroup): boolean => {
    const it = item as Record<string, unknown>;
    if (it && ("all" in it || "any" in it)) {
      return evaluateConditions(item as ConditionGroup, ctx, now);
    }
    return evalCondition(item as Condition, ctx, now);
  };
  return isAll ? items.every(judge) : items.some(judge);
}
