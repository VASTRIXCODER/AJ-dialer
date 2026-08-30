import { describe, expect, it } from "vitest";
import { CONNECTED_OUTCOMES } from "@/lib/call-analytics";
import { METRICS, isConnectedRecord, orgTimezone, type MetricId } from "@/lib/metrics/definitions";
import { outcomeMix, summarize, type MetricRow } from "@/lib/metrics/compute";

const T = "2026-08-27T15:00:00Z"; // startedAt is irrelevant to summarize/outcomeMix

const row = (r: Partial<MetricRow>): MetricRow => ({
  startedAt: T,
  outcome: null,
  durationSec: 0,
  ...r,
});

// ─────────────────────────────────────────────────────────────────────────────
// A 20-row hand-built day. Expected summary, worked by hand:
//   calls            = 20
//   eligibleAttempts = 18  (rows 15+16 are system failures: failureKind, no outcome)
//   humanConnects    =  9  (rows 1–6, 13, 19, 20 — voicemail NEVER counts, even
//                           with humanConnected=true; humanConnected=false vetoes
//                           a "qualified" outcome)
//   voicemails       =  3  (rows 8–10)
//   connectRate      = 50  (9 / 18 × 100)
//   avgTalkSec       = 86  ((120+300+90+45+30+75+10+64+40) / 9 = 774 / 9,
//                           talkSec preferred, durationSec only when absent)
// ─────────────────────────────────────────────────────────────────────────────
const FIXTURE: MetricRow[] = [
  /*  1 */ row({ outcome: "appointment_booked", talkSec: 120, durationSec: 150 }),
  /*  2 */ row({ outcome: "qualified", humanConnected: true, talkSec: 300, durationSec: 320 }),
  /*  3 */ row({ outcome: "callback_scheduled", durationSec: 90 }), // no talkSec → durationSec
  /*  4 */ row({ outcome: "not_interested", talkSec: 45, durationSec: 60 }),
  /*  5 */ row({ outcome: "do_not_call", talkSec: 30, durationSec: 40 }),
  /*  6 */ row({ outcome: "bills_fine", humanConnected: true, talkSec: 75, durationSec: 80 }),
  /*  7 */ row({ outcome: "bills_fine", durationSec: 20 }), // legacy: not a connected outcome
  /*  8 */ row({ outcome: "voicemail", durationSec: 25 }),
  /*  9 */ row({ outcome: "voicemail", humanConnected: true, durationSec: 30 }), // still NOT a connect
  /* 10 */ row({ outcome: "voicemail", humanConnected: false, durationSec: 15 }),
  /* 11 */ row({ outcome: "no_answer" }),
  /* 12 */ row({ outcome: "no_answer", humanConnected: false }),
  /* 13 */ row({ outcome: "wrong_number", humanConnected: true, talkSec: 10, durationSec: 12 }),
  /* 14 */ row({ outcome: "qualified", humanConnected: false, durationSec: 200 }), // flag vetoes
  /* 15 */ row({ outcome: null, failureKind: "carrier_error" }), // system failure
  /* 16 */ row({ outcome: null, failureKind: "provider_timeout" }), // system failure
  /* 17 */ row({ outcome: null }), // no outcome but NOT a failure → still eligible
  /* 18 */ row({ outcome: "no_answer", failureKind: "late_webhook" }), // outcome set → eligible
  /* 19 */ row({ outcome: "not_interested", talkSec: 64, durationSec: 70 }),
  /* 20 */ row({ outcome: null, humanConnected: true, talkSec: 40, durationSec: 50 }),
];

describe("summarize", () => {
  it("matches the hand-computed summary for the 20-row day", () => {
    expect(summarize(FIXTURE)).toEqual({
      calls: 20,
      eligibleAttempts: 18,
      humanConnects: 9,
      voicemails: 3,
      connectRate: 50,
      avgTalkSec: 86,
    });
  });

  it("rounds connect rate to one decimal", () => {
    const rows = [
      row({ outcome: "qualified" }),
      row({ outcome: "no_answer" }),
      row({ outcome: "no_answer" }),
    ];
    expect(summarize(rows).connectRate).toBe(33.3); // 1/3
  });

  it("returns zeros instead of NaN when the denominator is zero", () => {
    expect(summarize([])).toEqual({
      calls: 0,
      eligibleAttempts: 0,
      humanConnects: 0,
      voicemails: 0,
      connectRate: 0,
      avgTalkSec: 0,
    });
    // Only system failures: calls counted, rate still 0 (not NaN).
    const failures = [row({ failureKind: "carrier_error" })];
    expect(summarize(failures)).toMatchObject({ calls: 1, eligibleAttempts: 0, connectRate: 0 });
  });
});

describe("outcomeMix", () => {
  it("reconciles: counts sum + noOutcome === total, buckets mutually exclusive", () => {
    const mix = outcomeMix(FIXTURE);
    const summed = Object.values(mix.counts).reduce((a, b) => a + b, 0);
    expect(summed + mix.noOutcome).toBe(mix.total);
    expect(mix.total).toBe(FIXTURE.length);
    expect(mix.noOutcome).toBe(4); // rows 15, 16, 17, 20
    expect(mix.counts).toEqual({
      appointment_booked: 1,
      qualified: 2,
      callback_scheduled: 1,
      not_interested: 2,
      do_not_call: 1,
      bills_fine: 2,
      voicemail: 3,
      no_answer: 3,
      wrong_number: 1,
    });
  });
});

describe("METRICS glossary", () => {
  it("defines every MetricId with a non-empty description and consistent id", () => {
    // W5 added eleven ids for the numbers that appear on two or more screens
    // or are actively contested between them. tests/metric-registry.test.ts
    // owns the rules about which tiles carry which; this only checks the
    // glossary is complete and self-consistent.
    const ids: MetricId[] = [
      "calls_today",
      "calls_dialed",
      "human_connects",
      "connect_rate",
      "appointments_set",
      "appointment_outcomes",
      "appointment_show_rate",
      "avg_talk_time",
      "talk_time_total",
      "leads_worked",
      "speed_to_first_call",
      "callbacks_overdue",
      "callbacks_due_now",
      "estimated_call_spend",
      "cost_per_appointment",
    ];
    expect(Object.keys(METRICS).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      const def = METRICS[id];
      expect(def.id).toBe(id);
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("only ratio metrics declare a denominator", () => {
    expect(METRICS.connect_rate.denominator).not.toBeNull();
    expect(METRICS.avg_talk_time.denominator).not.toBeNull();
    expect(METRICS.calls_today.denominator).toBeNull();
  });
});

describe("isConnectedRecord", () => {
  it("trusts a verified humanConnected flag over the outcome", () => {
    expect(isConnectedRecord({ humanConnected: true, outcome: "no_answer" })).toBe(true);
    expect(isConnectedRecord({ humanConnected: true, outcome: null })).toBe(true);
    expect(isConnectedRecord({ humanConnected: false, outcome: "qualified" })).toBe(false);
    expect(isConnectedRecord({ humanConnected: false, outcome: null })).toBe(false);
  });

  it("never counts voicemail — even against humanConnected=true", () => {
    expect(isConnectedRecord({ humanConnected: true, outcome: "voicemail" })).toBe(false);
    expect(isConnectedRecord({ humanConnected: null, outcome: "voicemail" })).toBe(false);
    expect(isConnectedRecord({ outcome: "voicemail" })).toBe(false);
  });

  it("coalesces to CONNECTED_OUTCOMES when the flag is absent", () => {
    for (const outcome of CONNECTED_OUTCOMES) {
      expect(isConnectedRecord({ humanConnected: null, outcome })).toBe(true);
      expect(isConnectedRecord({ outcome })).toBe(true);
    }
    for (const outcome of ["bills_fine", "no_answer", "wrong_number", "voicemail"]) {
      expect(isConnectedRecord({ humanConnected: null, outcome })).toBe(false);
    }
    expect(isConnectedRecord({ humanConnected: null, outcome: null })).toBe(false);
    expect(isConnectedRecord({})).toBe(false);
  });
});

describe("orgTimezone", () => {
  it("uses the org's timezone when set", () => {
    expect(orgTimezone({ timezone: "America/New_York" })).toBe("America/New_York");
  });

  it("falls back to America/Chicago for null/missing/empty", () => {
    expect(orgTimezone({ timezone: null })).toBe("America/Chicago");
    expect(orgTimezone({ timezone: "" })).toBe("America/Chicago");
    expect(orgTimezone({})).toBe("America/Chicago");
    expect(orgTimezone(null)).toBe("America/Chicago");
    expect(orgTimezone(undefined)).toBe("America/Chicago");
  });
});
