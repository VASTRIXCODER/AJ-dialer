import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// A `.limit()` above PostgREST's response ceiling is not a limit. It is a lie
// about one.
//
// The service truncates every un-ranged response at its configured maximum
// (1,000 on this project — recorded at src/lib/db/leads.ts, where a 17,342-lead
// book rendered as exactly 1,000). Ask for 20,000 rows without `.range()` and
// you get 1,000, with no error and no signal. Two things then go wrong:
//
//   1. A count taken as `rows.length` saturates at the ceiling and is rendered
//      as a total. Measured before these were fixed: 9,816 leads across 73
//      packs shared out among every pack on the Assignments board; 34,079 call
//      records sampled at ~59% and rendered as six campaign totals; a floor
//      board whose DESC ordering meant truncation removed THIS MORNING.
//
//   2. A saturation check written as `rows.length >= LIMIT` can never fire
//      when LIMIT is above the ceiling — so the "≥" a screen renders to
//      disclose its own cap is unreachable, and the cap goes unmentioned
//      precisely when it bites. That was true of Command Center's
//      INSTANCE_SCAN = 2000 for its whole life.
//
// The rule: if you cap, say so; if you need a total, count it in SQL.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const CEILING = 1000;

function sourceFiles(): string[] {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  )
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /\.tsx?$/.test(l));
}

const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");

/** `.limit(20000)` / `.limit(20_000)` / `.limit(CONST)` with its resolved value. */
function limitsIn(code: string, consts: Map<string, number>): number[] {
  const out: number[] = [];
  for (const m of code.matchAll(/\.limit\(\s*([A-Za-z_$][\w$]*|[\d_]+)\s*\)/g)) {
    const raw = m[1];
    const n = /^[\d_]+$/.test(raw) ? Number(raw.replace(/_/g, "")) : consts.get(raw);
    if (typeof n === "number" && Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** `const NAME = 1234;` — enough to resolve the module-local scan bounds. */
function constsIn(code: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of code.matchAll(/const\s+([A-Z][A-Z0-9_]*)\s*=\s*([\d_]+)\s*;/g)) {
    out.set(m[1], Number(m[2].replace(/_/g, "")));
  }
  return out;
}

describe("no cap is bigger than the ceiling that overrides it", () => {
  it("every .limit() is either under the ceiling or paged", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = stripComments(read(file));
      if (!/\.limit\(/.test(code)) continue;
      // A query that also `.range()`s is paging deliberately; the limit there
      // is an overall scan bound, not a page size.
      const paged = /\.range\(/.test(code);
      for (const n of limitsIn(code, constsIn(code))) {
        if (n > CEILING && !paged) {
          offenders.push(`${file}: .limit(${n.toLocaleString()}) with no .range()`);
        }
      }
    }
    expect(
      offenders,
      "PostgREST truncates these at " +
        CEILING.toLocaleString() +
        " and says nothing. Page with .range(), or count in SQL:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("no saturation check compares against a number the ceiling makes unreachable", () => {
    // `rows.length >= SCAN` where SCAN > the ceiling is a disclosure that can
    // never print — the truncation happens first, at a smaller number.
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = stripComments(read(file));
      // A file that pages with .range() may legitimately bound the WHOLE scan
      // above the ceiling — that bound is reached by accumulating pages, not by
      // one response, so `>=` against it can fire.
      if (/\.range\(/.test(code)) continue;
      const consts = constsIn(code);
      for (const m of code.matchAll(/\.length\s*>=\s*([A-Z][A-Z0-9_]*|[\d_]+)/g)) {
        const raw = m[1];
        const n = /^[\d_]+$/.test(raw) ? Number(raw.replace(/_/g, "")) : consts.get(raw);
        if (typeof n === "number" && n > CEILING) {
          offenders.push(`${file}: length >= ${raw} (${n.toLocaleString()})`);
        }
      }
    }
    expect(
      offenders,
      "These can never be true — the response is truncated at " +
        CEILING.toLocaleString() +
        " first:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });
});

describe("the totals that used to be page lengths are counted in SQL", () => {
  const schema = read("supabase/schema.sql");

  // Each of these replaced a `.length` over a truncated fetch. Named here so a
  // future refactor that quietly reverts one has to delete a test to do it.
  const COUNTERS = [
    ["app_pack_progress", "assignment + lead-pack progress"],
    ["app_campaign_lead_counts", "campaign lead pipeline"],
    ["app_campaign_call_counts", "campaign call performance"],
    ["app_floor_calls_by_day", "Live Floor calls today"],
    ["app_owned_lead_counts", "the “where did my leads go?” probe"],
  ];

  for (const [fn, what] of COUNTERS) {
    it(`${fn} exists and backs ${what}`, () => {
      expect(schema).toMatch(new RegExp(`function public\\.${fn}\\(`));
      // …and nothing has revoked its own grants, which is how a security-definer
      // helper becomes reachable from the anon role.
      expect(schema).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon, authenticated;`),
      );
    });
  }

  it("the classification rules stayed in TypeScript", () => {
    // These functions GROUP. If one of them starts deciding what "connected" or
    // "dialable" means, there are two definitions in the product and they will
    // drift — which is the whole reason the callers sum an `n` column instead.
    const region = schema.slice(schema.indexOf("app_pack_progress"));
    for (const word of ["appointment_booked", "not_interested", "bills_fine"]) {
      expect(region, `${word} is a classification, and it belongs in TypeScript`).not.toContain(
        word,
      );
    }
  });
});
