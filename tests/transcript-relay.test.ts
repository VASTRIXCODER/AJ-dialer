import { describe, expect, it } from "vitest";
import {
  dedupeByTurnIndex,
  diffNewTurns,
  maxTurnIndex,
  type RelaySegment,
  type RelayTurn,
} from "@/lib/monitor/transcript-relay";

const turns: RelayTurn[] = [
  { role: "agent", message: "Hi, this is Atlas calling.", secs: 0 },
  { role: "user", message: "Who is this?", secs: 3 },
  { role: "agent", message: "", secs: 5 }, // provider silence — no message
  { role: "user", message: "  ", secs: 6 }, // whitespace-only — also silence
  { role: "agent", message: "Quick question about your account.", secs: 8 },
];

function seg(turnIndex: number, message = `m${turnIndex}`): RelaySegment {
  return { turnIndex, role: "agent", message, secs: null, final: true };
}

describe("diffNewTurns — the relay's provider diff", () => {
  it("returns everything past a fresh cursor (-1), skipping silent turns", () => {
    const out = diffNewTurns(turns, -1);
    expect(out.map((s) => s.turnIndex)).toEqual([0, 1, 4]);
    expect(out[0]).toMatchObject({
      role: "agent",
      message: "Hi, this is Atlas calling.",
      secs: 0,
      final: true,
    });
  });

  it("only yields turns strictly past the cursor", () => {
    expect(diffNewTurns(turns, 1).map((s) => s.turnIndex)).toEqual([4]);
    expect(diffNewTurns(turns, 4)).toEqual([]);
    expect(diffNewTurns(turns, 99)).toEqual([]);
  });

  it("silent turns are CONSUMED, not re-diffed: the cursor target is the array end", () => {
    // If the cursor advanced only to the last RETURNED index (1), turns 2-3
    // would be re-fetched forever. maxTurnIndex is what the cursor stores.
    expect(maxTurnIndex(turns)).toBe(4);
    expect(maxTurnIndex([])).toBe(-1);
  });

  it("normalizes junk: non-finite secs become null, missing role defaults to agent", () => {
    const out = diffNewTurns([{ role: "", message: "hey", secs: Number.NaN }], -1);
    expect(out[0]).toMatchObject({ role: "agent", secs: null });
  });
});

describe("dedupeByTurnIndex — double delivery is harmless", () => {
  it("merges broadcast + poll copies of the same turn to one, in order", () => {
    const existing = [seg(0), seg(2)];
    const merged = dedupeByTurnIndex(existing, [seg(1), seg(2, "revised"), seg(3)]);
    expect(merged.map((s) => s.turnIndex)).toEqual([0, 1, 2, 3]);
    // Incoming wins — a finalized revision replaces the earlier copy.
    expect(merged.find((s) => s.turnIndex === 2)?.message).toBe("revised");
  });

  it("returns the SAME array when nothing arrives (cheap React short-circuit)", () => {
    const existing = [seg(0)];
    expect(dedupeByTurnIndex(existing, [])).toBe(existing);
  });

  it("ignores segments with a non-finite turnIndex", () => {
    const merged = dedupeByTurnIndex([], [
      seg(0),
      { ...seg(1), turnIndex: Number.NaN },
    ]);
    expect(merged.map((s) => s.turnIndex)).toEqual([0]);
  });
});
