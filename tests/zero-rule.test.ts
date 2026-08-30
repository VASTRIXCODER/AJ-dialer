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
// This is not a theoretical concern in this codebase. supabase-js does NOT
// throw on a failed read; it resolves `{ data: null, count: null, error }`. So
// the house idiom `res.count ?? 0` silently converts "we could not ask" into
// "the answer is none", and a `try/catch` around it never fires. A previous
// audit found this producing four separate user-visible bugs in code written
// the same day, including a frequency cap that failed OPEN and a pipeline board
// that looked healthy precisely because it was broken.
//
// The fix at each site is the same shape: `res.error ? null : (res.count ?? 0)`,
// then let the type be `number | null` all the way to the tile, which renders
// an em dash.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const DB_FILES = execSync('git ls-files --cached --others --exclude-standard "src/lib/db/*.ts"', {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .map((path) => ({ path, text: readFileSync(resolve(ROOT, path), "utf8") }));

/**
 * Modules still defaulting a possibly-failed count to 0, with what each one
 * feeds. Every entry is a real "a failed read looks like a clean board" bug
 * waiting to be surfaced — this list should only ever shrink.
 *
 * NOT a permanent exemption. Migrated so far: crm.ts (Phase 2) and
 * command-center.ts, whose counts are now `number | null` end to end.
 */
const NOT_YET_MIGRATED: Record<string, string> = {
  "src/lib/db/my-day.ts": "a rep's own day strip and callback counts",
  "src/lib/db/callbacks.ts": "the completed-callback count on the board header",
  "src/lib/db/crm.ts": "claimable/held on the shared queue (lane counts already migrated)",
  "src/lib/db/pipeline.ts": "bills-fine totals and the completed-appointment count",
  "src/lib/db/records.ts": "the call-archive rollup counters",
  "src/lib/db/lead-timeline.ts": "a per-page row count, not a displayed metric",
};

describe("the zero rule", () => {
  it("no NEW module defaults a possibly-failed count to zero", () => {
    const offenders: string[] = [];
    for (const { path, text } of DB_FILES) {
      if (NOT_YET_MIGRATED[path]) continue;
      for (const line of text.split(/\r?\n/)) {
        // `error ? null : (count ?? 0)` is the correct shape and is allowed.
        if (/\.count \?\? 0/.test(line) && !/\berror\b/.test(line)) {
          offenders.push(`${path}: ${line.trim()}`);
        }
      }
    }
    expect(
      offenders,
      "supabase-js resolves rather than throws on a failed read, so `count ?? 0` " +
        "turns 'could not ask' into 'the answer is none'. Use " +
        "`res.error ? null : (res.count ?? 0)` and let the null reach the tile:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("the migration list has no stale entries", () => {
    // When a module is cleaned up, its entry must go — otherwise the list
    // stops meaning anything and the rule quietly stops applying to it.
    const stale = Object.keys(NOT_YET_MIGRATED).filter((path) => {
      const f = DB_FILES.find((x) => x.path === path);
      if (!f) return true;
      return !f.text
        .split(/\r?\n/)
        .some((l) => /\.count \?\? 0/.test(l) && !/\berror\b/.test(l));
    });
    expect(
      stale,
      `These no longer default a failed count to 0 — remove them from NOT_YET_MIGRATED:\n${stale.join("\n")}`,
    ).toEqual([]);
  });

  it("the already-migrated modules stay migrated", () => {
    for (const path of ["src/lib/db/command-center.ts"]) {
      const f = DB_FILES.find((x) => x.path === path);
      expect(f, `${path} is missing`).toBeDefined();
      const bare = f!.text
        .split(/\r?\n/)
        .filter((l) => /\.count \?\? 0/.test(l) && !/\berror\b/.test(l));
      expect(bare, `${path} regressed:\n${bare.join("\n")}`).toEqual([]);
    }
  });

  it("a metric tile can express 'unavailable' at the type level", () => {
    const card = readFileSync(
      resolve(ROOT, "src/components/dashboard/metric-card.tsx"),
      "utf8",
    );
    // If `value` were `string`, a caller with a null count would have no way
    // to say so and would reach for String(x) or `?? 0`.
    expect(card).toMatch(/value:\s*string \| null/);
    expect(card).toMatch(/unavailable\?:\s*string/);
  });
});
