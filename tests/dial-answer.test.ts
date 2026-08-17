import { describe, expect, it } from "vitest";
import { resolveAnswer, type LegStatus } from "@/lib/dial-answer";

const leg = (leadId: string, sid: string, status: string): LegStatus => ({ leadId, sid, status });

describe("resolveAnswer", () => {
  it("picks the first in-progress leg as the winner", () => {
    const d = resolveAnswer([leg("a", "1", "ringing"), leg("b", "2", "in-progress")]);
    expect(d.answeredLeadId).toBe("b");
    expect(d.done).toBe(false);
  });

  it("releases still-ringing losers", () => {
    const d = resolveAnswer([leg("a", "1", "in-progress"), leg("b", "2", "ringing")]);
    expect(d.answeredLeadId).toBe("a");
    expect(d.release).toEqual(["2"]);
  });

  it("releases a SECOND answered leg (double-answer) — the P2 privacy fix", () => {
    const d = resolveAnswer([leg("a", "1", "in-progress"), leg("b", "2", "in-progress")]);
    expect(d.answeredLeadId).toBe("a"); // first in placement order wins
    expect(d.release).toEqual(["2"]); // the extra homeowner is dropped
  });

  it("never releases the winner", () => {
    const d = resolveAnswer([leg("a", "1", "in-progress")]);
    expect(d.release).not.toContain("1");
    expect(d.release).toEqual([]);
  });

  it("does not release a leg that already ended", () => {
    const d = resolveAnswer([leg("a", "1", "in-progress"), leg("b", "2", "completed")]);
    expect(d.answeredLeadId).toBe("a");
    expect(d.release).toEqual([]); // completed is neither ringing nor in-progress
  });

  it("is done once every leg is terminal", () => {
    const d = resolveAnswer([leg("a", "1", "completed"), leg("b", "2", "no-answer")]);
    expect(d.answeredLeadId).toBeNull();
    expect(d.done).toBe(true);
    expect(d.release).toEqual([]);
  });

  it("a single terminated leg reads as done (drives the hangup watch)", () => {
    expect(resolveAnswer([leg("a", "1", "completed")]).done).toBe(true);
  });

  it("is not done while a leg is still ringing", () => {
    expect(resolveAnswer([leg("a", "1", "ringing")]).done).toBe(false);
  });
});
