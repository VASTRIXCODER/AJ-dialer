import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  METRICS,
  describeScope,
  describeWindow,
  metricCaption,
  type MetricId,
} from "@/lib/metrics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// Every number a rep reads says what it counts, over what window, for whom.
//
// A six-agent audit enumerated all 65 tile-shaped surfaces in the product. What
// it found was not mostly missing tooltips — it was that "Appointments" meant
// FIVE different things (rows in the appointments table; calls dispositioned
// appointment_booked; leads whose status is appointment; a funnel stage; a cost
// denominator), "Upcoming" meant two, and "Needs review" meant two, with
// nothing on any tile to tell them apart. The same window was written three
// ways on three screens.
//
// So window and scope are ENUMS whose words come from one module, and a tile
// either carries a definition or has a stated reason why not. The reason
// matters as much as the key: a glossary entry on a number that has not been
// reconciled with its namesake is worse than silence, because it certifies the
// disagreement.
// ─────────────────────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const FILES = execSync('git ls-files --cached --others --exclude-standard "src/**/*.tsx"', {
  cwd: ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean)
  .map((path) => ({ path, code: read(path) }));

/** Every `<MetricCard … />` call site, with the file it lives in. */
function tiles(): { path: string; source: string; label: string }[] {
  const out: { path: string; source: string; label: string }[] = [];
  for (const { path, code } of FILES) {
    if (path.endsWith("metric-card.tsx")) continue;
    for (const m of code.matchAll(/<MetricCard[\s\S]{0,1400}?\/>/g)) {
      const label = (m[0].match(/label=\{?["`]?([^"`}\n]{0,50})/)?.[1] ?? "?").trim();
      out.push({ path, source: m[0], label });
    }
  }
  return out;
}

/**
 * Tiles that deliberately carry NO `definitionKey`, each with the reason.
 *
 * Two kinds live here, and the distinction is the point:
 *
 *   · a number that is genuinely single-screen operational reporting. Naming it
 *     in a shared glossary implies it was reconciled with something. It wasn't,
 *     because there is nothing to reconcile it against.
 *   · a number that shares a LABEL with a different number elsewhere, or whose
 *     query is known to be wrong. Keying those would be worse than leaving
 *     them: the tooltip would assert a reconciliation that has not happened.
 */
const UNKEYED: Record<string, string> = {
  // ── Label collisions across screens. Same word, different table.
  "appointments-workspace.tsx:Needs review":
    "/callbacks shows 'Needs review' over the call_review_queue — a different table",
  "appointments-workspace.tsx:Upcoming":
    "/callbacks shows 'Upcoming' over open callbacks with any future due time",
  "callbacks/page.tsx:Upcoming":
    "/appointments shows 'Upcoming' over a bounded today→+7d→later window",
  "appointments-workspace.tsx:Completed":
    "counts appointments; /callbacks 'Completed' counts callbacks",
  "callbacks/page.tsx:Completed":
    "counts callbacks; /appointments 'Completed' counts appointments",

  // ── Single-screen operational counts. Nothing to reconcile them against.
  "bills-fine/page.tsx:Total": "the size of one status list, on one screen",
  "bills-fine/page.tsx:With ${primaryLabel.toLowerCase()": "one screen's field-completeness count",
  "bills-fine/page.tsx:Avg monthly spend": "the mean of two org-configurable fields, on one screen",
  "command/page.tsx:New ${vocab.leadNounPlural": "lead rows created today, on one screen",
  "super-console.tsx:Organizations": "platform ops, not a sales metric",
  "super-console.tsx:Companies": "platform ops, not a sales metric",
  "super-console.tsx:Accounts": "platform ops, and a page size — see the tile's own note",
  "super-console.tsx:Pending": "platform ops, not a sales metric",
  "super-console.tsx:Suspended": "platform ops, not a sales metric",
  "super-console.tsx:App status": "not a metric at all — a word in a numeric slot",

  // ── Campaign tiles.
  //
  // The sampling is FIXED: these were computed over a capped, id-ordered prefix
  // of the org's call history, and `id` is a gen_random_uuid() primary key, so
  // the cap took an arbitrary ~59% of 34,079 rows rather than a prefix of
  // anything. They are now counted in SQL (app_campaign_lead_counts /
  // app_campaign_call_counts) with no ceiling. "Contacted" and "Connect rate"
  // were also re-based on the product's own definitions.
  //
  // What remains is about the LABELS, not the math — which is why these still
  // carry no definitionKey: a glossary entry would certify a scope the tile
  // does not disclose.
  "campaigns/[id]/page.tsx:Leads":
    "org-wide for every viewer including a plain rep; scope=\"campaign\" does not disclose that",
  "campaigns/[id]/page.tsx:Dialable status":
    "a status test that does not re-check DNC, phone validity, the attempt cap or the calling window — the label now says so",
  "campaigns/[id]/page.tsx:Contacted":
    "org-wide for every viewer; the math itself is now last_contacted_at, matching the Assignments board",
  "campaigns/[id]/page.tsx:Calls": "org-wide for every viewer including a plain rep",
  "campaigns/[id]/page.tsx:Connect rate":
    "goes through isConnectedRecord now, but is still org-wide for every viewer",
  "campaigns/[id]/page.tsx:Appointments":
    "a call-event count sharing its label with the appointments-table count on two other screens",
};

const keyOf = (t: { path: string; label: string }) => `${t.path}:${t.label}`;

describe("the registry reaches every tile, or says why not", () => {
  const ALL = tiles();

  it("finds the tiles", () => {
    // If this collapses, every assertion below passes vacuously.
    expect(ALL.length).toBeGreaterThan(40);
  });

  it("every tile either carries a definition or has a stated reason", () => {
    const offenders = ALL.filter((t) => {
      if (/definitionKey=/.test(t.source)) return false;
      const k = keyOf(t);
      return !Object.keys(UNKEYED).some((allowed) => k.endsWith(allowed));
    }).map((t) => `${t.path} — "${t.label}"`);
    expect(
      offenders,
      "Give the tile a definitionKey, or add it to UNKEYED with the reason it " +
        "should not have one:\n" + offenders.join("\n"),
    ).toEqual([]);
  });

  it("the exemption list has no stale entries", () => {
    // An exemption that outlives its reason is how the exception becomes the
    // rule. Each entry must still match an unkeyed tile.
    const live = new Set(
      ALL.filter((t) => !/definitionKey=/.test(t.source)).map((t) => keyOf(t)),
    );
    const stale = Object.keys(UNKEYED).filter(
      (allowed) => ![...live].some((k) => k.endsWith(allowed)),
    );
    expect(stale, `No longer unkeyed (drop the exemption):\n${stale.join("\n")}`).toEqual([]);
  });

  it("every tile states its window and its scope", () => {
    // This one has no exemptions. A number with no window and no scope is not
    // a number, it is a rumour — it does not matter whether it is in the
    // glossary. `sub` is accepted for the handful whose caption is genuinely
    // something other than a window and a scope.
    const offenders = ALL.filter(
      (t) => !(/\bwindow=/.test(t.source) && /\bscope=/.test(t.source)) && !/\bsub=/.test(t.source),
    ).map((t) => `${t.path} — "${t.label}"`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no tile phrases its own window", () => {
    // The whole point of the enums. A `sub` that re-states a window in prose
    // is how "today", "dials placed today" and "Today so far · you" ended up
    // on three screens describing the same rows.
    const offenders: string[] = [];
    for (const t of ALL) {
      const sub = t.source.match(/\bsub=\{?["`]([^"`]{0,80})/)?.[1];
      if (!sub) continue;
      if (/\b(today|yesterday|this week|this month|last \d+ days|90d|30d|7d|all[- ]time)\b/i.test(sub)) {
        offenders.push(`${t.path} — "${t.label}" says "${sub}"`);
      }
    }
    expect(
      offenders,
      `Use window={…} so the words come from one place:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});

describe("the glossary itself", () => {
  it("every id in the union has a definition, and every definition is reachable", () => {
    const ids = Object.keys(METRICS) as MetricId[];
    for (const id of ids) {
      expect(METRICS[id].id, `${id} disagrees with its own key`).toBe(id);
    }
    // The union and the record cannot drift: TypeScript enforces one direction,
    // this asserts the record is not carrying anything the union dropped.
    const source = read("src/lib/metrics/definitions.ts");
    const unionStart = source.indexOf("export type MetricId");
    const union = source.slice(unionStart, source.indexOf(";", unionStart));
    for (const id of ids) {
      expect(union, `${id} is in METRICS but not in the MetricId union`).toContain(`"${id}"`);
    }
  });

  it("a definition that divides says what it divides by", () => {
    for (const def of Object.values(METRICS)) {
      if (def.unit !== "percent") continue;
      expect(def.denominator, `${def.id} is a percentage with no stated denominator`).toBeTruthy();
    }
  });

  it("a definition says what it leaves out", () => {
    // `excludes` is what stops a tooltip from being a restatement of the label.
    // The four aggregate/series definitions genuinely exclude nothing.
    const SERIES: MetricId[] = [
      "weekly_performance",
      "outcome_mix",
      "hourly_productivity",
      "campaign_pipeline",
    ];
    for (const def of Object.values(METRICS)) {
      if (SERIES.includes(def.id)) continue;
      expect(def.excludes.length, `${def.id} excludes nothing`).toBeGreaterThan(0);
    }
  });

  it("the two appointment metrics say they are different from each other", () => {
    // The single most confused pair in the product. Each tooltip has to send
    // the reader to the other one, or a rep comparing two screens concludes
    // the app is broken.
    expect(METRICS.appointments_set.description).toMatch(/appointment/i);
    expect(METRICS.appointment_outcomes.description).toMatch(/EVENT count/);
    expect(METRICS.appointment_outcomes.description).toMatch(/Appointments set/);
  });

  it("captions read as one sentence, from one place", () => {
    expect(metricCaption("today", "org")).toBe("today · whole org");
    expect(metricCaption("last_90d", "me")).toBe("last 90 days · you");
    expect(metricCaption("period", "org", "1–30 Aug")).toBe(
      "selected period (1–30 Aug) · whole org",
    );
    expect(describeWindow("all_time")).toBe("all time");
    expect(describeScope("platform")).toBe("whole platform");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A definition is a promise. Six of the original nine were describing something
// the code does not do — and these are the tooltips a rep opens precisely
// because they want to know what a number means:
//
//   avg_talk_time         "Uses talk_sec when present"      talk_sec: 0 of 34,079 rows
//   human_connects        "verified human-connected state"  human_connected: 0 of 34,079
//   connect_rate          "excluding system failures"       failure_kind was never SELECTed
//   weekly_performance    "org-tz calendar week"            code did a rolling 7 days
//   outcome_mix           "never silently dropped"          20.4% of rows were
//   hourly_productivity   "grouped by local hour"           code iterated 8am–6pm only,
//                                                            hiding 31.5% of the book
//
// Three were fixed in the code, three in the words. This is the rule that keeps
// them together.
// ─────────────────────────────────────────────────────────────────────────────

describe("a definition cannot describe something the code does not do", () => {
  const SRC = execSync(
    'git ls-files --cached --others --exclude-standard "src/**/*.ts" "src/**/*.tsx"',
    { cwd: ROOT, encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  const ALL_SOURCE = SRC.map((p) => read(p)).join("\n");

  /**
   * Database columns a description may name.
   *
   * The test is about WRITES, not selects — `talk_sec` is in the SELECT list
   * and has never been written by anything, which is exactly how a tooltip
   * came to describe a column that is empty in all 34,079 rows.
   */
  const COLUMNS = ["talk_sec", "human_connected", "failure_kind", "duration_sec"];

  it("a description names a column only if something writes it, or admits it does not", () => {
    // A tooltip that cites a column nothing populates is the most convincing
    // kind of wrong: it reads like precision.
    const offenders: string[] = [];
    for (const def of Object.values(METRICS)) {
      for (const col of COLUMNS) {
        if (!def.description.includes(col)) continue;
        // Naming it in order to say it is NOT written is honest, and is the
        // only way a reader learns why the number is inferred.
        if (def.description.includes("nothing writes it")) continue;
        const written = new RegExp(`\b${col}:`).test(ALL_SOURCE);
        if (!written) {
          offenders.push(`${def.id} names ${col}, which no code writes`);
        }
      }
    }
    expect(
      offenders,
      "Either write the column, or say in the description that nothing does:\n" +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("connect_rate's denominator exclusion is one the code can actually make", () => {
    // The definition promised to exclude system failures and the column was
    // never in the SELECT, so the shipped rate could not have matched its own
    // tooltip whatever the data said.
    const metrics = read("src/lib/db/metrics.ts");
    expect(METRICS.connect_rate.denominator).toMatch(/failure_kind/);
    expect(metrics, "failure_kind is not selected").toMatch(/failure_kind/);
    expect(metrics, "the denominator does not exclude them").toMatch(/eligibleAttempts/);
    expect(metrics).toMatch(/connectRate: pct\(connections, eligibleAttempts\)/);
  });

  it("outcome_mix divides by attempts that have an outcome", () => {
    // It divided by ALL attempts while skipping the ones with no outcome, so
    // the buckets could never sum to 100% and every disposition was understated
    // in proportion to how much work was still unfiled.
    const analytics = read("src/lib/call-analytics.ts");
    expect(analytics).toMatch(/rate: pct\(counts\[key\] \?\? 0, filed\)/);
    expect(analytics, "the unfiled rows are not reported anywhere").toMatch(
      /export function withoutOutcome/,
    );
    expect(METRICS.outcome_mix.description).toMatch(/reported separately/);
  });

  it("hourly_productivity does not hide the ends of the day", () => {
    const metrics = read("src/lib/db/metrics.ts");
    expect(metrics, "the hour loop is still a fixed business window").not.toMatch(
      /for \(let h = 8; h <= 18; h\+\+\)/,
    );
    expect(metrics).toMatch(/const firstHour = Math\.min\(8/);
    expect(metrics).toMatch(/const lastHour = Math\.max\(18/);
  });

  it("weekly_performance says which seven days it means", () => {
    // The dashboard renders buildSeries(7) — a rolling window ending today, not
    // the configured calendar week the leaderboard uses.
    expect(METRICS.weekly_performance.description).toMatch(/rolling|last seven/i);
    expect(METRICS.weekly_performance.description).toMatch(/NOT the calendar week/);
  });
});
