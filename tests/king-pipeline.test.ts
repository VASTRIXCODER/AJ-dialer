import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { METRICS, type MetricId } from "@/lib/metrics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// King's pipeline view (docs/phase_two.md §17) must not invent a number.
//
// §17 says "do not hard-code example numbers". The harder version of that rule,
// and the one this file enforces, is: do not COMPUTE a number you cannot
// honestly compute. Five of King's ten cards depend on facts this deployment
// does not have —
//
//   Confirmed  no confirmation channel exists
//   At risk    no risk rule has been published
//   Recovered  nothing links a rebooking to the no-show it replaced
//   Sales      no trusted fulfillment source is wired
//   Installs   the same
//
// — and a sixth, Follow-up completion, has no window to measure "on time"
// against. Each of those renders blank WITH A REASON. A fabricated zero on a
// leadership dashboard is worse than a hard-coded one, because it looks earned:
// "0 sales today" reads as a bad day, not as a missing integration.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const SOURCE = read("src/lib/db/king-pipeline.ts");
const PAGE = read("src/app/(app)/pipeline/page.tsx");
const CARD = read("src/components/dashboard/metric-card.tsx");

/** The §17 cards that can never be computed in this deployment. */
const STRUCTURALLY_UNAVAILABLE: MetricId[] = [
  "appointments_confirmed",
  "appointments_at_risk",
  "no_show_recovered",
  "sales_closed",
  "installs_completed",
  "followup_completion",
];

describe("the glossary tells the truth about what cannot be measured", () => {
  for (const id of STRUCTURALLY_UNAVAILABLE) {
    it(`${id} says so in its own definition`, () => {
      const def = METRICS[id];
      expect(def, `${id} is not in the glossary`).toBeTruthy();
      // The tooltip is what a manager reads when they wonder about the blank.
      // It has to lead with the fact, not bury it.
      expect(
        def.description.startsWith("NOT COMPUTABLE"),
        `${id}: "${def.description.slice(0, 60)}…" must open with NOT COMPUTABLE`,
      ).toBe(true);
      // …and say what specifically is missing, not just that something is.
      expect(def.description.length, `${id} gives no reason`).toBeGreaterThan(120);
    });
  }

  it("the measurable ones do NOT claim to be unavailable", () => {
    for (const id of ["leads_worked", "contacts_made", "hot_opportunities", "speed_to_lead"] as const) {
      expect(METRICS[id].description.startsWith("NOT COMPUTABLE")).toBe(false);
    }
  });
});

describe("the data layer never turns a failed read into zero", () => {
  it("the no-show count returns null on error rather than `count ?? 0`", () => {
    // supabase-js resolves rather than throws, so `count ?? 0` here would tell
    // King that nobody missed an appointment today.
    expect(SOURCE).toMatch(/if \(error\) return \{ noShows: null \};/);
    // Order is the whole point: the error branch must come FIRST, so the
    // `?? 0` below it only ever means a genuine zero from a query that ran.
    const errIdx = SOURCE.indexOf("if (error) return { noShows: null };");
    const zeroIdx = SOURCE.indexOf("noShows: count ?? 0");
    expect(zeroIdx, "the zero fallback is missing").toBeGreaterThan(-1);
    expect(errIdx, "a failed count would coalesce to zero").toBeLessThan(zeroIdx);
  });

  it("every structurally-unavailable card is hard-coded to null with a reason", () => {
    for (const id of STRUCTURALLY_UNAVAILABLE) {
      const block = SOURCE.slice(SOURCE.indexOf(`id: "${id}"`));
      const card = block.slice(0, block.indexOf("},"));
      expect(card, `${id} must be null`).toMatch(/value: null/);
      expect(card, `${id} must carry a reason`).toMatch(/unavailable:/);
    }
  });

  it("a missing org-wide read is announced, not rendered as a quiet day", () => {
    expect(SOURCE).toMatch(/degraded = true/);
    expect(PAGE).toMatch(/data\.degraded &&/);
    expect(PAGE, "the degraded banner must say what it means").toMatch(
      /not a quiet day/,
    );
  });

  it("the channel health section reports 'cannot read' rather than disappearing", () => {
    // Without a service role the heartbeats are invisible. Dropping the section
    // would tell King the automation question does not apply to them.
    const guard = SOURCE.slice(SOURCE.indexOf("if (!isAdminConfigured())"), SOURCE.indexOf("let settings"));
    expect(guard, "the no-service-role branch must explain itself").toMatch(
      /be read from here/,
    );
    expect(guard, "all three channels must still be listed").toMatch(
      /playbooks[\s\S]*email[\s\S]*sms/,
    );
  });
});

describe("MetricCard cannot render a blank without saying why", () => {
  it("accepts null and renders an em dash for it", () => {
    expect(CARD).toMatch(/value: string \| null/);
    expect(CARD).toMatch(/const missing = value === null/);
    expect(CARD).toMatch(/"—"/);
  });

  it("the reason replaces the sub-label rather than competing with it", () => {
    // An em dash on its own is a small mystery: the reader cannot tell a broken
    // query from a feature nobody switched on.
    expect(CARD).toMatch(/missing && unavailable \?/);
  });

  it("the blank is announced to a screen reader", () => {
    expect(CARD).toMatch(/not available/);
  });
});

describe("the page keeps its promises to §17", () => {
  it("every strip card carries a glossary definition", () => {
    // §17: "Every card must show definition, date/timezone, freshness…"
    expect(PAGE).toMatch(/definitionKey=\{card\.id\}/);
  });

  it("it states its timezone and freshness in the header", () => {
    expect(PAGE).toMatch(/relativeTime\(data\.generatedAt\)/);
    expect(PAGE).toMatch(/\{tz\}/);
  });

  it("cards drill down only when they have somewhere to go", () => {
    // A tile that looks clickable and does nothing is worse than a plain one.
    expect(PAGE).toMatch(/card\.href \? \(/);
  });

  it("structural gaps are grouped, not scattered through the working numbers", () => {
    expect(PAGE).toMatch(/function isStructural/);
    expect(PAGE).toMatch(/Not measurable in this workspace/);
  });

  it("panels with nothing in them collapse", () => {
    // The codebase convention, and the thing that makes a page look unfinished
    // when it is broken.
    expect(PAGE).toMatch(/data\.channels\.length > 0 &&/);
    expect(PAGE).toMatch(/liveLeaks\.length > 0 &&/);
    expect(PAGE).toMatch(/data\.reps\.length > 0 &&/);
    expect(PAGE).toMatch(/data\.playbooks\.length > 0 &&/);
  });

  it("it is reachable from the nav, behind the reports permission", () => {
    const nav = read("src/components/layout/nav.ts");
    expect(nav).toMatch(/href: "\/pipeline"/);
    const entry = nav.slice(nav.indexOf('href: "/pipeline"'));
    expect(entry.slice(0, 200)).toMatch(/permission: "reports\.view"/);
  });

  it("it composes the shared reads instead of re-querying", () => {
    // §17: "Extend the Phase 1 shared metrics service. Do not recalculate these
    // independently in each widget."
    expect(SOURCE).toMatch(/getCommandCenter/);
    expect(SOURCE, "the strip must not run its own call_records scan").not.toMatch(
      /from\("call_records"\)/,
    );
  });
});

describe("no industry noun is hardcoded", () => {
  it("the page speaks the workspace's own vocabulary", () => {
    expect(PAGE).toMatch(/orgVocabulary\(viewer\.org\)/);
    const banned = /\b(homeowner|solar|utility bill)\b/i;
    // Comments are prose and may name the vertical when explaining history.
    const code = PAGE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(?<!:)\/\/.*$/gm, "");
    expect(banned.test(code), "an industry noun leaked into the markup").toBe(false);
  });
});

describe("the whole surface still type-checks against the real schema", () => {
  it("references only columns that exist", () => {
    // Cheap guard against a typo'd column name that would only fail at runtime,
    // on a manager's screen. These are the four tables this module reads.
    for (const table of ["app_settings", "messages", "notification_outbox", "message_templates"]) {
      expect(SOURCE).toContain(`from("${table}")`);
    }
    expect(SOURCE).toMatch(/orchestration_last_tick_at/);
    expect(SOURCE).toMatch(/messaging_last_tick_at/);
  });

  it("is tracked by git, so the other source-wide gates see it", () => {
    const tracked = execFileSync("git", ["ls-files", "src/lib/db/king-pipeline.ts"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(tracked.trim().length, "add the new module to git").toBeGreaterThan(0);
  });
});
