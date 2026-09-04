import { describe, expect, it } from "vitest";
import {
  aiDialInFlight,
  canRedial,
  isAdHoc,
  redialTargets,
  type RedialCandidate,
} from "@/lib/dialer/ai-redial";

// ─────────────────────────────────────────────────────────────────────────────
// The reported gap: "For the ai dialer, there is no dial again button."
//
// The manual dialer has always had Redial. The AI side had none, so a call that
// rang out or died on connect was lost unless the whole list ran again. These
// pin the rules that decide when the new button may fire — every one of them
// exists because getting it wrong dials a real person twice.
// ─────────────────────────────────────────────────────────────────────────────

const row = (leadId: string, conversationId: string | null = "conv_1"): RedialCandidate => ({
  leadId,
  conversationId,
});

describe("canRedial", () => {
  it("allows a finished call", () => {
    expect(canRedial(row("lead_1"), false)).toBe(true);
  });

  it("refuses a call still on the wire", () => {
    // The whole point: a live call must not be re-dialed underneath itself.
    expect(canRedial(row("lead_1"), true)).toBe(false);
  });

  it("refuses an ad-hoc number from the dial pad", () => {
    // No lead record behind `manual-<ts>` — there is nothing to look up.
    expect(canRedial(row("manual-abc123"), false)).toBe(false);
  });

  it("allows a call that failed before it got a conversation", () => {
    // A dial Twilio rejected outright has no conversationId and can't be
    // expanded — it is exactly the row most worth re-ringing.
    expect(canRedial(row("lead_1", null), false)).toBe(true);
  });
});

describe("isAdHoc", () => {
  it("recognises the pad's synthetic ids", () => {
    expect(isAdHoc("manual-lz4x9")).toBe(true);
  });
  it("leaves real lead ids alone", () => {
    expect(isAdHoc("lead_1")).toBe(false);
    // A real id that merely CONTAINS the word is not a pad id.
    expect(isAdHoc("a-manual-lead")).toBe(false);
  });
});

describe("redialTargets — the bulk 'Dial again (N)'", () => {
  const dead = () => false;

  it("returns every finished row", () => {
    const calls = [row("a"), row("b"), row("c")];
    expect(redialTargets(calls, dead).map((c) => c.leadId)).toEqual(["a", "b", "c"]);
  });

  it("keeps only the NEWEST row per lead", () => {
    // `calls` is newest-first, and one lead accumulates rows: first attempt, the
    // automatic double-tap, an earlier manual re-dial. One call per ROW would
    // ring one homeowner three times off a single press.
    const calls = [row("a"), row("b"), row("a"), row("a")];
    expect(redialTargets(calls, dead).map((c) => c.leadId)).toEqual(["a", "b"]);
  });

  it("excludes rows that are still live", () => {
    const calls = [row("live", "conv_live"), row("done", "conv_done")];
    const isLive = (c: RedialCandidate) => c.leadId === "live";
    expect(redialTargets(calls, isLive).map((c) => c.leadId)).toEqual(["done"]);
  });

  it("does not resurrect a lead whose NEWEST row is live", () => {
    // Same lead, live now and finished earlier. It is on the wire — the older
    // finished row must not make it a target.
    const calls = [row("a", "conv_now"), row("a", "conv_before")];
    const isLive = (c: RedialCandidate) => c.conversationId === "conv_now";
    expect(redialTargets(calls, isLive)).toEqual([]);
  });

  it("drops ad-hoc rows from a bulk press", () => {
    const calls = [row("manual-1"), row("lead_1")];
    expect(redialTargets(calls, dead).map((c) => c.leadId)).toEqual(["lead_1"]);
  });

  it("is empty for an empty session", () => {
    expect(redialTargets([], dead)).toEqual([]);
  });
});

describe("aiDialInFlight — the guard before any dial goes out", () => {
  const none = new Set<string>();

  it("blocks a lead currently being dialed", () => {
    expect(aiDialInFlight("a", new Set(["lead:a"]), none)).toBe(true);
  });

  it("blocks a lead holding a line for its double-tap", () => {
    expect(aiDialInFlight("a", new Set(["redial:a"]), none)).toBe(true);
  });

  it("blocks a lead scheduled for the double-tap", () => {
    expect(aiDialInFlight("a", none, new Set(["a"]))).toBe(true);
  });

  it("allows a lead that is genuinely idle", () => {
    expect(aiDialInFlight("a", new Set(["lead:b", "conv_9"]), new Set(["c"]))).toBe(false);
  });

  it("does not confuse a conversation id for a line reservation", () => {
    // Reservations are `lead:<id>`; a bare conversation id in the same set must
    // not read as "this lead is busy".
    expect(aiDialInFlight("a", new Set(["a"]), none)).toBe(false);
  });
});
