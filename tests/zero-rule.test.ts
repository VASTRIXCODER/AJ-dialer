import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// THE ZERO RULE.
//
// A number that could not be computed renders as absent, never as 0. Zero is a
// real answer — "nobody called today" — and a reader cannot tell it apart from
// "the query failed".
//
// This is not theoretical here. supabase-js does NOT throw on a failed read; it
// resolves `{ data: null, count: null, error }`. So the idiom `res.count ?? 0`
// silently converts "we could not ask" into "the answer is none", and a
// try/catch around it never fires. Found in the wild in this codebase:
//
//   · a rep's day said "Nothing is waiting on you" because
//     `null + null + null === 0` is true in JavaScript
//   · a supervisor's attention queues DISAPPEARED, because each door was gated
//     on `count > 0` and `null > 0` is false
//   · an AI connect rate reported a confident 0%
//   · a frequency cap failed OPEN
//
// The fix at each site is `askedCount(res)` from src/lib/db/counts.ts, then
// `number | null` all the way to the tile, which renders an em dash.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");

/** Comments are prose. A comment quoting the bad pattern is documentation. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");

const DB_FILES = execSync('git ls-files --cached --others --exclude-standard "src/lib/db/*.ts"', {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .map((path) => ({
    path,
    code: stripComments(readFileSync(resolve(ROOT, path), "utf8")),
  }));

/**
 * A supabase query result, by this codebase's naming convention (`dialsRes`,
 * `countRes`, `heldCountRes`). Deliberately narrow: `p.count ?? 0` in
 * lead-timeline reads how many leads were in an assignment batch off a lead
 * EVENT payload, which is an ordinary property with an ordinary default and
 * not this bug at all.
 */
const BAD = /\b\w*(?:Res|Result)\.count \?\? 0/;

describe("the zero rule", () => {
  it("no query result defaults a possibly-failed count to zero", () => {
    const offenders: string[] = [];
    for (const { path, code } of DB_FILES) {
      for (const line of code.split(/\r?\n/)) {
        // `error ? null : (count ?? 0)` is the correct shape, written out.
        if (BAD.test(line) && !/\berror\b/.test(line)) offenders.push(`${path}: ${line.trim()}`);
      }
    }
    expect(
      offenders,
      "supabase-js resolves rather than throws on a failed read, so `count ?? 0` " +
        "turns 'could not ask' into 'the answer is none'. Use askedCount() from " +
        "src/lib/db/counts.ts and let the null reach the tile:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the modules that feed a visible number use askedCount", () => {
    // Named explicitly so deleting the call re-breaks the test rather than
    // quietly passing because the file no longer matches a pattern.
    const MIGRATED = [
      "src/lib/db/command-center.ts",
      "src/lib/db/my-day.ts",
      "src/lib/db/callbacks.ts",
      "src/lib/db/crm.ts",
      "src/lib/db/pipeline.ts",
      "src/lib/db/records.ts",
    ];
    for (const path of MIGRATED) {
      const f = DB_FILES.find((x) => x.path === path);
      expect(f, `${path} is missing`).toBeDefined();
      expect(f!.code, `${path} should read its counts through askedCount`).toMatch(
        /askedCount\(/,
      );
    }
  });

  it("a metric tile can express 'unavailable' at the type level", () => {
    const card = readFileSync(resolve(ROOT, "src/components/dashboard/metric-card.tsx"), "utf8");
    // If `value` were `string`, a caller holding a null count would have no way
    // to say so and would reach for String(x) or `?? 0`.
    expect(card).toMatch(/value:\s*string \| null/);
    expect(card).toMatch(/unavailable\?:\s*string/);
  });

  it("sumKnown keeps 'unknown' distinct from 'zero'", async () => {
    const { sumKnown, askedCount } = await import("@/lib/db/counts");

    // The exact shape that told a rep nothing was waiting on them.
    expect(sumKnown([null, null, null])).toEqual({ total: 0, unknown: 3 });
    expect(sumKnown([0, 0, 0])).toEqual({ total: 0, unknown: 0 });
    expect(sumKnown([2, null, 3])).toEqual({ total: 5, unknown: 1 });

    // And the primitive itself: an error is null, a genuine zero stays zero.
    expect(askedCount({ count: null, error: new Error("boom") })).toBeNull();
    expect(askedCount({ count: 0, error: null })).toBe(0);
    expect(askedCount({ count: 7, error: null })).toBe(7);
    // A null count with no error is a head:true query that matched nothing.
    expect(askedCount({ count: null, error: null })).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// …and the half of the rule this file used to miss entirely.
//
// Everything above scans src/lib/db. The DB layer was CORRECT — it plumbed
// `number | null` all the way up, exactly as intended — and two pages threw it
// away on the last line:
//
//     <MetricCard value={String(board.completedCount)} …/>
//     <MetricCard value={String(withBills)} …/>
//
// `String(null)` is the four-character string "null". MetricCard's parseMetric
// cannot read a number out of it, so it falls through to rendering `value`
// verbatim — the word "null", in 40px tabular numerals, where a total belongs.
// Not a fabricated zero: visible nonsense, on /callbacks and /bills-fine.
//
// A tile is where the rule is finally kept or broken, so the tiles are checked
// too.
// ─────────────────────────────────────────────────────────────────────────────

const RENDER_FILES = execSync(
  'git ls-files --cached --others --exclude-standard "src/app/**/*.tsx" "src/components/**/*.tsx"',
  { cwd: ROOT, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean)
  .map((path) => ({
    path,
    code: stripComments(readFileSync(resolve(ROOT, path), "utf8")),
  }));

/** Every `<MetricCard … />` call site, as source text. */
function metricCards(code: string): string[] {
  return [...code.matchAll(/<MetricCard[\s\S]{0,900}?\/>/g)].map((m) => m[0]);
}

describe("the render layer keeps the rule the db layer plumbed", () => {
  it("the card itself refuses a stringified nothing", () => {
    // Guarding in the card rather than only at the call sites is what makes the
    // class impossible: `String(x)` on a nullable count is an easy thing to
    // write, and the next person to write it will not have read this file.
    const card = readFileSync(
      resolve(ROOT, "src/components/dashboard/metric-card.tsx"),
      "utf8",
    );
    for (const nothing of ['value === "null"', 'value === "undefined"', 'value === "NaN"']) {
      expect(card, `the card does not guard ${nothing}`).toContain(nothing);
    }
    // …and every read downstream uses the GUARDED value. Otherwise the card
    // would render an em dash while its caption and its delta still took the
    // has-a-number branch — a tile that says two things at once.
    const body = card.slice(card.indexOf("const resolved"));
    expect(body, "a downstream read still tests the raw `value`").not.toMatch(
      /\bvalue (?:===|!==) null/,
    );
  });

  it("no tile passes an em dash as if it were a value", () => {
    // Handing MetricCard the string "—" defeats the rule from the other side:
    // `value` is truthy, so the card takes its normal path and `unavailable` —
    // the line that would say WHY the number is missing — becomes unreachable.
    const offenders: string[] = [];
    for (const { path, code } of RENDER_FILES) {
      for (const tile of metricCards(code)) {
        if (/value=\{[\s\S]*?:\s*"—"\s*\}/.test(tile)) {
          offenders.push(`${path}: ${tile.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    expect(
      offenders,
      `Pass null and an \`unavailable\` reason, not a dash:\n` + offenders.join("\n"),
    ).toEqual([]);
  });

  it("a tile that can be unavailable says why", () => {
    // An em dash with no explanation is its own small mystery — MetricCard's
    // own prop doc says so. If a call site can pass null, it must pass a reason.
    const offenders: string[] = [];
    for (const { path, code } of RENDER_FILES) {
      for (const tile of metricCards(code)) {
        const canBeNull = /value=\{[^}]*(?:===\s*null|!==\s*null|\?\?\s*null|:\s*null)/.test(tile);
        if (canBeNull && !/unavailable=/.test(tile)) {
          offenders.push(`${path}: ${tile.replace(/\s+/g, " ").slice(0, 90)}`);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
