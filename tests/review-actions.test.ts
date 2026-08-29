import { describe, expect, it } from "vitest";
import {
  actionRequiresKey,
  applyReviewAction,
  canActOnReview,
  type ReviewAction,
  type ReviewStatus,
} from "@/lib/reviews/actions";

describe("applyReviewAction — transition validity", () => {
  it("open + accept → resolved / 'accepted'", () => {
    expect(applyReviewAction("open", "accept")).toEqual({
      ok: true,
      status: "resolved",
      resolution: "accepted",
    });
  });

  it("open + change → resolved / 'changed'", () => {
    expect(applyReviewAction("open", "change")).toEqual({
      ok: true,
      status: "resolved",
      resolution: "changed",
    });
  });

  it("open + dismiss → dismissed / 'dismissed'", () => {
    expect(applyReviewAction("open", "dismiss")).toEqual({
      ok: true,
      status: "dismissed",
      resolution: "dismissed",
    });
  });

  it("non-open rows refuse every action (replays can't re-write the record)", () => {
    const terminal: ReviewStatus[] = ["resolved", "dismissed"];
    const actions: ReviewAction[] = ["accept", "change", "dismiss"];
    for (const status of terminal) {
      for (const action of actions) {
        const result = applyReviewAction(status, action);
        expect(result.ok).toBe(false);
      }
    }
  });

  it("an unknown action is refused, not defaulted", () => {
    const result = applyReviewAction("open", "approve" as ReviewAction);
    expect(result.ok).toBe(false);
  });
});

describe("actionRequiresKey — what each action needs to proceed", () => {
  it("accept uses the proposal's key and fails without one", () => {
    expect(actionRequiresKey("accept", "qualified", null)).toEqual({
      ok: true,
      key: "qualified",
    });
    expect(actionRequiresKey("accept", null, null).ok).toBe(false);
  });

  it("change uses the picker's key and fails without one", () => {
    expect(actionRequiresKey("change", "qualified", "not_interested")).toEqual({
      ok: true,
      key: "not_interested",
    });
    expect(actionRequiresKey("change", "qualified", null).ok).toBe(false);
  });

  it("dismiss touches no record — no key needed", () => {
    expect(actionRequiresKey("dismiss", null, null)).toEqual({ ok: true, key: null });
  });
});

describe("canActOnReview — supervisor or record owner", () => {
  it("supervisors always may", () => {
    expect(
      canActOnReview({ supervisor: true, userId: "u1", recordOwnerId: null }),
    ).toBe(true);
  });

  it("the record's owner may; another rep may not", () => {
    expect(
      canActOnReview({ supervisor: false, userId: "u1", recordOwnerId: "u1" }),
    ).toBe(true);
    expect(
      canActOnReview({ supervisor: false, userId: "u2", recordOwnerId: "u1" }),
    ).toBe(false);
  });

  it("a row with no call record is supervisor-only (no owner to grant through)", () => {
    expect(
      canActOnReview({ supervisor: false, userId: "u1", recordOwnerId: null }),
    ).toBe(false);
  });
});
