import { describe, expect, it } from "vitest";
import {
  DEFAULT_AI_DISPOSITION_POLICY,
  aiMaySupersede,
  decideDispositionAction,
  mergeAiDispositionPolicy,
  type AiDispositionPolicy,
} from "@/lib/ai/disposition-policy";

const policy: AiDispositionPolicy = {
  autoApplyMin: 0.8,
  alwaysReview: ["do_not_call"],
  reviewOnMissingTranscript: true,
};

/** Shorthand: a confident, benign, transcript-backed proposal into a null slot. */
function base(over: Partial<Parameters<typeof decideDispositionAction>[0]> = {}) {
  return decideDispositionAction({
    confidence: 0.9,
    outcome: "qualified",
    proposedKey: "qualified",
    hasTranscript: true,
    currentDisposition: null,
    policy,
    ...over,
  });
}

describe("aiMaySupersede — the override chain's one hard rule", () => {
  it("an AI writer may NEVER supersede a human row", () => {
    expect(aiMaySupersede("human")).toBe(false);
  });
  it("AI may replace its own earlier output, or write fresh", () => {
    expect(aiMaySupersede("ai")).toBe(true);
    expect(aiMaySupersede(null)).toBe(true);
  });
});

describe("decideDispositionAction — auto-apply policy matrix", () => {
  it("auto-applies: confident + transcript + benign + empty slot", () => {
    expect(base()).toEqual({ action: "auto_apply" });
  });

  it("exactly at the threshold auto-applies (>= autoApplyMin)", () => {
    expect(base({ confidence: 0.8 })).toEqual({ action: "auto_apply" });
  });

  it("below the threshold ⇒ review(low_confidence)", () => {
    expect(base({ confidence: 0.79 })).toEqual({
      action: "review",
      reason: "low_confidence",
    });
  });

  it("alwaysReview outcome ⇒ review(high_impact) even at confidence 1.0", () => {
    expect(
      base({ confidence: 1, outcome: "do_not_call", proposedKey: "do_not_call" }),
    ).toEqual({ action: "review", reason: "high_impact" });
  });

  it("matches alwaysReview against the proposed KEY too, not just the outcome", () => {
    expect(
      decideDispositionAction({
        confidence: 1,
        outcome: "not_interested",
        proposedKey: "do_not_call",
        hasTranscript: true,
        currentDisposition: null,
        policy,
      }),
    ).toEqual({ action: "review", reason: "high_impact" });
  });

  it("missing transcript ⇒ review(missing_transcript), regardless of confidence", () => {
    expect(base({ hasTranscript: false, confidence: 0.99 })).toEqual({
      action: "review",
      reason: "missing_transcript",
    });
  });

  it("missing transcript with the policy OFF ⇒ none (never a silent auto-apply)", () => {
    expect(
      base({
        hasTranscript: false,
        policy: { ...policy, reviewOnMissingTranscript: false },
      }),
    ).toEqual({ action: "none", why: "no_review_policy" });
  });

  it("missing transcript outranks alwaysReview only when the slot is empty and the policy is on", () => {
    // No transcript at all: nothing is verifiable, so the missing-transcript
    // reason wins the ordering.
    expect(
      base({ hasTranscript: false, outcome: "do_not_call", proposedKey: "do_not_call" }),
    ).toEqual({ action: "review", reason: "missing_transcript" });
  });
});

describe("decideDispositionAction — never overwrite an existing value", () => {
  it("agreeing with the filed key ⇒ none (confirmation is not news)", () => {
    expect(base({ currentDisposition: "qualified" })).toEqual({
      action: "none",
      why: "agrees_with_current",
    });
  });

  it("disagreeing with a filed benign key ⇒ none — the human already decided", () => {
    expect(base({ currentDisposition: "not_interested" })).toEqual({
      action: "none",
      why: "already_dispositioned",
    });
  });

  it("disagreeing on a HIGH-IMPACT proposal ⇒ review — the compliance catch", () => {
    expect(
      base({
        currentDisposition: "qualified",
        outcome: "do_not_call",
        proposedKey: "do_not_call",
      }),
    ).toEqual({ action: "review", reason: "high_impact" });
  });

  it("a filled slot never auto-applies, even at full confidence with a transcript", () => {
    const d = base({ currentDisposition: "no_answer", confidence: 1 });
    expect(d.action).not.toBe("auto_apply");
  });
});

describe("mergeAiDispositionPolicy — stored blob sanitation", () => {
  it("empty/absent → the defaults (as fresh copies)", () => {
    const merged = mergeAiDispositionPolicy(undefined);
    expect(merged).toEqual(DEFAULT_AI_DISPOSITION_POLICY);
    expect(merged.alwaysReview).not.toBe(DEFAULT_AI_DISPOSITION_POLICY.alwaysReview);
  });

  it("clamps autoApplyMin into [0,1]; junk falls back to the default", () => {
    expect(mergeAiDispositionPolicy({ autoApplyMin: 5 }).autoApplyMin).toBe(1);
    expect(mergeAiDispositionPolicy({ autoApplyMin: -1 }).autoApplyMin).toBe(0);
    expect(mergeAiDispositionPolicy({ autoApplyMin: "high" }).autoApplyMin).toBe(0.8);
  });

  it("alwaysReview replaces wholesale, drops non-string entries — and do_not_call is pinned", () => {
    const merged = mergeAiDispositionPolicy({
      alwaysReview: ["wrong_number", 42, ""],
    });
    // Custom entries replace the default list, but do_not_call rides along
    // regardless: an AI proposal that suppresses a number forever always gets
    // a human look, whatever a stored blob (or the admin editor) says.
    expect(merged.alwaysReview).toEqual(["wrong_number", "do_not_call"]);
    // "Clearing" the list still keeps the compliance pin — that's the point.
    expect(mergeAiDispositionPolicy({ alwaysReview: [] }).alwaysReview).toEqual([
      "do_not_call",
    ]);
    // A blob that already lists it doesn't get a duplicate.
    expect(
      mergeAiDispositionPolicy({ alwaysReview: ["do_not_call"] }).alwaysReview,
    ).toEqual(["do_not_call"]);
  });

  it("reviewOnMissingTranscript keeps only a real boolean", () => {
    expect(
      mergeAiDispositionPolicy({ reviewOnMissingTranscript: false })
        .reviewOnMissingTranscript,
    ).toBe(false);
    expect(
      mergeAiDispositionPolicy({ reviewOnMissingTranscript: "no" })
        .reviewOnMissingTranscript,
    ).toBe(true);
  });
});
