import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isConnectedRow } from "@/lib/call-analytics";
import {
  CONNECTED_OUTCOMES,
  connectedRecordFilter,
  isCancelledAppointment,
  isConnectedRecord,
} from "@/lib/metrics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// "Did a human answer?" — one question, and the product had FIVE answers.
//
// The canonical predicate is `isConnectedRecord`. Its docstring explains why it
// vetoes voicemail: AMD race conditions have been observed setting
// `human_connected = true` on machine pickups, and a voicemail must never
// inflate a connect rate. It was also the only implementation that honoured its
// own rule.
//
//   A  isConnectedRecord                    — the definition
//   B  SQL coalesce(...)                    — supabase/schema.sql
//   C  PostgREST .or(...)                   — my-day.ts, command-center.ts
//   D  hand-rolled JS === true || has(...)  — command-center.ts
//   E  isConnectedRow (outcome only)        — call-analytics.ts, the funnels
//
// The most visible consequence was on /reports, where the "Connections" tile
// (A) and the conversion funnel about sixty pixels below it (E) are computed
// from the SAME array over the SAME window and printed different numbers.
//
// C, D and E now delegate to A. This file is the thing that keeps them there:
// it evaluates the PostgREST filter's own semantics in JS and asserts it agrees
// with the function over every combination that can exist in the table.
// ─────────────────────────────────────────────────────────────────────────────

type Row = { human_connected: boolean | null; outcome: string | null };

/**
 * A tiny evaluator for the subset of PostgREST that `connectedRecordFilter`
 * emits: a comma-joined OR of `and(...)` groups, each a comma-joined AND of
 * `column.op.value` terms.
 *
 * Deliberately strict — it throws on anything it does not recognise, so a
 * future edit to the filter that uses an operator this test cannot model fails
 * loudly here instead of silently going unchecked.
 */
function evalPostgrest(filter: string, row: Row): boolean {
  const groups: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of filter) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      groups.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) groups.push(current);

  return groups.some((group) => {
    const inner = group.startsWith("and(") ? group.slice(4, -1) : group;
    // Split the AND terms, keeping `in.(a,b,c)` lists intact.
    const terms: string[] = [];
    let d = 0;
    let t = "";
    for (const ch of inner) {
      if (ch === "(") d++;
      if (ch === ")") d--;
      if (ch === "," && d === 0) {
        terms.push(t);
        t = "";
        continue;
      }
      t += ch;
    }
    if (t) terms.push(t);

    return terms.every((term) => {
      const [column, op, ...rest] = term.split(".");
      const value = rest.join(".");
      const actual = row[column as keyof Row];
      switch (op) {
        case "is":
          return value === "true"
            ? actual === true
            : value === "false"
              ? actual === false
              : actual === null;
        case "eq":
          return actual === value;
        case "neq":
          // SQL three-valued logic: NULL <> 'x' is NULL, which is not TRUE.
          return actual !== null && actual !== value;
        case "in":
          return actual !== null && value.slice(1, -1).split(",").includes(String(actual));
        default:
          throw new Error(`evalPostgrest cannot model operator "${op}" in "${term}"`);
      }
    });
  });
}

/** Every row shape the two columns can take, including the adversarial ones. */
const ROWS: Row[] = [];
for (const human_connected of [true, false, null]) {
  for (const outcome of [...CONNECTED_OUTCOMES, "voicemail", "no_answer", "wrong_number", null]) {
    ROWS.push({ human_connected, outcome });
  }
}

const asRecord = (r: Row) => ({ humanConnected: r.human_connected, outcome: r.outcome });

describe("every connect predicate answers the same question", () => {
  it("the SQL filter and the function agree on every possible row", () => {
    const filter = connectedRecordFilter();
    const disagreements = ROWS.filter(
      (r) => evalPostgrest(filter, r) !== isConnectedRecord(asRecord(r)),
    ).map((r) => `human_connected=${r.human_connected} outcome=${r.outcome}`);
    expect(
      disagreements,
      `The .or() filter and isConnectedRecord disagree on:\n${disagreements.join("\n")}`,
    ).toEqual([]);
  });

  it("the funnel's row test and the function agree on every possible row", () => {
    const disagreements = ROWS.filter(
      (r) => isConnectedRow(r as unknown as Record<string, unknown>) !== isConnectedRecord(asRecord(r)),
    ).map((r) => `human_connected=${r.human_connected} outcome=${r.outcome}`);
    expect(disagreements, disagreements.join("\n")).toEqual([]);
  });

  it("the two rows the old implementations got wrong", () => {
    // These are not hypotheticals — they are the exact shapes the predicate's
    // docstring was written for, and the shapes the shipped `.or()` counted.
    const voicemailFlaggedHuman: Row = { human_connected: true, outcome: "voicemail" };
    const verifiedNotHumanButQualified: Row = { human_connected: false, outcome: "qualified" };

    expect(isConnectedRecord(asRecord(voicemailFlaggedHuman)), "AMD set the flag on a machine").toBe(false);
    expect(isConnectedRecord(asRecord(verifiedNotHumanButQualified)), "the verified flag wins").toBe(false);

    // The old expression, for the record. Both of these were counted.
    const OLD = `human_connected.is.true,outcome.in.(${[...CONNECTED_OUTCOMES].join(",")})`;
    expect(evalPostgrest(OLD, voicemailFlaggedHuman)).toBe(true);
    expect(evalPostgrest(OLD, verifiedNotHumanButQualified)).toBe(true);
    // …and neither is now.
    const NOW = connectedRecordFilter();
    expect(evalPostgrest(NOW, voicemailFlaggedHuman)).toBe(false);
    expect(evalPostgrest(NOW, verifiedNotHumanButQualified)).toBe(false);
  });

  it("both errors pushed the same way — up", () => {
    // Which is why a rep's "Conversations" tile read higher than their own
    // connect rate on the dashboard, every day, rather than jittering.
    const filter = connectedRecordFilter();
    const OLD = `human_connected.is.true,outcome.in.(${[...CONNECTED_OUTCOMES].join(",")})`;
    const oldCount = ROWS.filter((r) => evalPostgrest(OLD, r)).length;
    const nowCount = ROWS.filter((r) => evalPostgrest(filter, r)).length;
    expect(nowCount).toBeLessThan(oldCount);
  });

  it("no surface hand-rolls the predicate any more", () => {
    // The two `.or()` copies and the JS one. A new copy would pass every test
    // above — the tests only see what they are handed — so this looks for the
    // shape of the mistake instead.
    const ROOT = resolve(__dirname, "..");
    for (const path of ["src/lib/db/my-day.ts", "src/lib/db/command-center.ts"]) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
      expect(code, `${path} still builds its own connect filter`).not.toMatch(
        /human_connected\.is\.true,outcome\.in/,
      );
      expect(code, `${path} does not use the canonical filter`).toMatch(/connectedRecordFilter\(\)/);
    }
  });
});

describe("a cancelled appointment is cancelled in both spellings", () => {
  it("excludes either spelling", () => {
    // `appointments.status` is a bare text column with no CHECK constraint, and
    // two modules disagreed about this: compute.ts excluded both spellings,
    // db/metrics.ts — which feeds the two shipped tiles that carry
    // definitionKey="appointments_set" — excluded only the British one.
    expect(isCancelledAppointment("cancelled")).toBe(true);
    expect(isCancelledAppointment("canceled")).toBe(true);
    expect(isCancelledAppointment("scheduled")).toBe(false);
    expect(isCancelledAppointment("completed")).toBe(false);
    expect(isCancelledAppointment(null)).toBe(false);
    expect(isCancelledAppointment(undefined)).toBe(false);
  });

  it("nothing compares the status to a bare string any more", () => {
    const ROOT = resolve(__dirname, "..");
    for (const path of ["src/lib/db/metrics.ts", "src/lib/metrics/compute.ts"]) {
      const source = readFileSync(resolve(ROOT, path), "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
      expect(code, `${path} tests one spelling directly`).not.toMatch(
        /status\s*[!=]==\s*"cancell?ed"/,
      );
    }
  });
});
