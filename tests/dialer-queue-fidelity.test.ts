import { describe, expect, it } from "vitest";
import {
  advanceCursorPastClaims,
  orderedCandidateIds,
  reorderClaimed,
  strictQueueExhaustedMessage,
} from "@/lib/dialer/claims";
import { sanitizeGroups } from "@/lib/dialer/segments";
import { parseDialerSessionPrefs } from "@/lib/dialer/user-prefs";

// ─────────────────────────────────────────────────────────────────────────────
// The queue-fidelity patch: claims used to carry NO lead scoping, so Start
// dialed the org pool's top-eligibility lead — someone who was not in the list
// the rep loaded, and the SAME someone on every retry. These helpers are the
// client half of the fix; p_preserve_order in app_claim_dial_leads is the
// server half.
// ─────────────────────────────────────────────────────────────────────────────

const q = (ids: string[]) => ids.map((id) => ({ id }));

describe("orderedCandidateIds — the claim is the queue, from where the rep stands", () => {
  it("starts at the cursor and wraps around the list exactly once", () => {
    expect(orderedCandidateIds(q(["a", "b", "c", "d"]), 2, 10)).toEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
  });

  it("caps at max and handles cursor overflow (the engine wraps modulo length)", () => {
    expect(orderedCandidateIds(q(["a", "b", "c"]), 7, 2)).toEqual(["b", "c"]);
  });

  it("empty queue / zero max ⇒ no candidates (Start must not fall back to the pool)", () => {
    expect(orderedCandidateIds([], 0, 10)).toEqual([]);
    expect(orderedCandidateIds(q(["a"]), 0, 0)).toEqual([]);
  });

  it("dedupes repeated ids without losing order", () => {
    expect(orderedCandidateIds(q(["a", "b", "a", "c"]), 0, 10)).toEqual(["a", "b", "c"]);
  });
});

describe("reorderClaimed — the round runs in the rep's order", () => {
  it("restores candidate order whatever the server returned", () => {
    const claimed = q(["c", "a", "b"]);
    expect(reorderClaimed(claimed, ["a", "b", "c"]).map((l) => l.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("unknown ids (a refill claim) keep their relative order at the end", () => {
    const claimed = q(["x", "a", "y"]);
    expect(reorderClaimed(claimed, ["a"]).map((l) => l.id)).toEqual(["a", "x", "y"]);
  });
});

describe("advanceCursorPastClaims — the next Start keeps walking forward", () => {
  it("moves just past the furthest claimed lead", () => {
    expect(advanceCursorPastClaims(q(["a", "b", "c", "d"]), 0, ["a", "b"])).toBe(2);
  });

  it("wraps: claiming across the end of the list lands at the top", () => {
    expect(advanceCursorPastClaims(q(["a", "b", "c"]), 2, ["c", "a"])).toBe(1);
  });

  it("refill claims (ids not in the queue) leave the cursor alone", () => {
    expect(advanceCursorPastClaims(q(["a", "b"]), 1, ["zz"])).toBe(1);
    expect(advanceCursorPastClaims([], 3, ["a"])).toBe(3);
  });
});

describe("strictQueueExhaustedMessage — the honest end-of-list line", () => {
  it("distinguishes empty book, exhausted list, and failed refill", () => {
    expect(strictQueueExhaustedMessage(0, false)).toContain("No leads are loaded");
    expect(strictQueueExhaustedMessage(25, false)).toContain("Auto-refill");
    expect(strictQueueExhaustedMessage(25, true)).toContain("found nothing eligible");
  });
});

describe("sanitizeGroups", () => {
  it("dedupes, trims, drops junk, and caps the list", () => {
    expect(sanitizeGroups([" fresno ", "fresno", "", 42, "unsorted"])).toEqual([
      "fresno",
      "unsorted",
    ]);
    expect(sanitizeGroups("nope")).toEqual([]);
    expect(sanitizeGroups(Array.from({ length: 40 }, (_, i) => `g${i}`)).length).toBe(24);
  });
});

describe("parseDialerSessionPrefs", () => {
  it("null for a rep who never used the builder; strictOrder defaults TRUE", () => {
    expect(parseDialerSessionPrefs({})).toBeNull();
    expect(parseDialerSessionPrefs(null)).toBeNull();
    const p = parseDialerSessionPrefs({ dialerSession: { refill: true } });
    expect(p).toEqual({ statuses: [], strictOrder: true, refill: true });
    // A malformed strictOrder never reads as pool mode.
    expect(
      parseDialerSessionPrefs({ dialerSession: { strictOrder: "no" } })?.strictOrder,
    ).toBe(true);
    expect(
      parseDialerSessionPrefs({ dialerSession: { strictOrder: false } })?.strictOrder,
    ).toBe(false);
  });
});
