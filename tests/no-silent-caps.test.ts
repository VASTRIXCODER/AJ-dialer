import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CONNECTED_OUTCOMES } from "@/lib/metrics/definitions";

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
  /**
   * Files whose `.limit()` above the ceiling is a deliberate whole-scan bound.
   *
   * This used to be inferred: any file containing a `.range()` anywhere got a
   * blanket pass for every limit in it. That is one paging loop excusing an
   * unrelated un-ranged query in the same module — the exact shape of the bug
   * this file exists to catch. Measured when it was tightened: the exemption
   * was covering nothing, so an explicit list costs nothing and closes it.
   */
  const WHOLE_SCAN_BOUNDS = new Set<string>([]);

  it("every .limit() is either under the ceiling or an explicit scan bound", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const code = stripComments(read(file));
      if (!/\.limit\(/.test(code) || WHOLE_SCAN_BOUNDS.has(file)) continue;
      for (const n of limitsIn(code, constsIn(code))) {
        if (n > CEILING) {
          offenders.push(`${file}: .limit(${n.toLocaleString()})`);
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
      // Never reachable from `anon`. These are SECURITY DEFINER, so they run
      // with the owner's rights and bypass RLS entirely — a grant to anon would
      // be a public read of the whole table.
      expect(schema, `${fn} is reachable from anon`).toMatch(
        new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public, anon`),
      );
      // Reachable from `authenticated` ONLY when it defends itself. Three of
      // these are called with the SESSION client on the no-service-role path
      // (getCampaigns and getReportingData fall back to own-scoped reads), so
      // they need that grant — and the moment a definer function that takes an
      // org id has it, it is a cross-tenant read with extra steps.
      const grantsAuthenticated = new RegExp(
        `grant execute on function public\\.${fn}\\([^)]*\\) to authenticated`,
      ).test(schema);
      if (grantsAuthenticated) {
        const start = schema.indexOf(`function public.${fn}(`);
        const body = schema.slice(start, schema.indexOf("$$;", start));
        expect(body, `${fn} is callable by any signed-in user and never checks who`).toContain(
          "perform public.app_guard_self_scope(p_column, p_value);",
        );
      }
    });
  }

  it("no SECURITY DEFINER function is granted to anon", () => {
    // `anon` is the key that ships in every browser bundle, and a definer
    // function runs with the owner's rights — it does not see RLS at all. So a
    // grant to anon is a public, unauthenticated read of whatever the function
    // touches.
    //
    // app_list_joinable_orgs was granted that way. Confirmed over HTTP with the
    // public key: POST /rest/v1/rpc/app_list_joinable_orgs returned the id,
    // name, industry and slug of EVERY active workspace on the platform, to
    // anybody. Its only caller is the Hub picker, behind the auth gate.
    // Every `grant ... to ... anon` in the file, matched back to the function it
    // names — simpler and stricter than trying to pair declarations with
    // grants, because a definer function is the only kind this schema declares.
    const offenders: string[] = [];
    for (const m of schema.matchAll(
      /grant execute on function (public\.\w+)\([^)]*\)\s*(?:\n\s*)?to ([^;]+);/g,
    )) {
      const [, name, roles] = m;
      if (/\banon\b/.test(roles)) offenders.push(name);
    }
    expect(offenders, `Granted to anon: ${offenders.join(", ")}`).toEqual([]);
  });

  it("revoking from anon also revokes from PUBLIC", () => {
    // PUBLIC holds execute by default and anon inherits it, so
    // `revoke ... from anon` on its own changes nothing — which is exactly how
    // app_list_joinable_orgs stayed reachable after somebody had already
    // thought about it.
    const offenders: string[] = [];
    for (const m of schema.matchAll(/revoke execute on function (public\.\w+)\([^)]*\) from ([^;]+);/g)) {
      const from = m[2];
      if (/anon/.test(from) && !/public/.test(from)) offenders.push(m[1]);
    }
    expect(offenders, `Revoked from anon but not PUBLIC: ${offenders.join(", ")}`).toEqual([]);
  });

  it("the self-scope guard is the thing it claims to be", () => {
    // service_role may ask anything; anybody else may only ask about
    // themselves. Verified against the live database while writing it: another
    // org's rows REFUSED, another user's rows REFUSED, their own ALLOWED.
    const start = schema.indexOf("function public.app_guard_self_scope(");
    expect(start, "the guard is missing").toBeGreaterThan(-1);
    const body = schema.slice(start, schema.indexOf("$$;", start));
    expect(body, "service_role must not be blocked by its own guard").toContain("service_role");
    expect(body, "the guard never compares against the caller").toMatch(
      /p_value is distinct from auth\.uid\(\)/,
    );
    expect(body, "the guard permits an org-scoped ask").toMatch(/p_column <> 'owner_id'/);
    expect(schema, "the guard itself is reachable from anon").toMatch(
      /revoke all on function public\.app_guard_self_scope\(text, uuid\) from public, anon;/,
    );
  });

  it("the counting functions do not classify", () => {
    // They GROUP. If one of them starts deciding what "connected" or "dialable"
    // means there are two definitions in the product, and they will drift —
    // which is the whole reason the callers sum an `n` column instead.
    for (const [fn] of COUNTERS) {
      const start = schema.indexOf(`function public.${fn}(`);
      const body = schema.slice(start, schema.indexOf("$$;", start));
      for (const word of ["appointment_booked", "not_interested", "bills_fine"]) {
        expect(body, `${fn} classifies — that belongs in TypeScript`).not.toContain(word);
      }
    }
  });

  it("the one view that MUST restate 'connected' restates it exactly", () => {
    // touches_v is a view an analyst reads directly, so it has to carry a
    // `connected` column, and SQL cannot import isConnectedRecord. That makes
    // it the single legitimate second copy of the definition — and it was
    // wrong for its whole life: `coalesce(human_connected, false)` over a
    // column nothing writes, so the column read false for all 34,079 rows.
    //
    // The duplication stays; the drift does not.
    const view = schema.slice(schema.indexOf("create or replace view public.touches_v"));
    const list = view.slice(view.indexOf("array["), view.indexOf("])", view.indexOf("array[")));
    const inSql = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inSql, "touches_v and CONNECTED_OUTCOMES disagree").toEqual(
      [...CONNECTED_OUTCOMES].sort(),
    );
    // …and the two rules that are not a list.
    expect(view, "voicemail must never count as a connect").toMatch(
      /when outcome = 'voicemail'::text then false/,
    );
    expect(view, "the verified flag must win over the outcome inference").toMatch(
      /when human_connected is not null then human_connected/,
    );
  });
});
