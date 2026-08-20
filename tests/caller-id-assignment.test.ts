import { describe, expect, it } from "vitest";
import {
  MAX_CALLER_IDS_PER_REP,
  planAutoAssignCallerIds,
  restrictToAssignedNumbers,
} from "@/lib/dialer/rotation";

const POOL = ["+15550000001", "+15550000002", "+15550000003"];

describe("restrictToAssignedNumbers", () => {
  it("never restricts owner/admin/manager, regardless of any assignment", () => {
    for (const role of ["owner", "admin", "manager"] as const) {
      expect(restrictToAssignedNumbers(POOL, role, ["+15550000001"])).toEqual(POOL);
      expect(restrictToAssignedNumbers(POOL, role, [])).toEqual(POOL);
    }
  });

  it("restricts a rep to their assigned numbers, in pool order", () => {
    const got = restrictToAssignedNumbers(POOL, "rep", [
      "+15550000003",
      "+15550000001",
    ]);
    expect(got).toEqual(["+15550000001", "+15550000003"]); // pool order, not assignment order
  });

  it("falls back to the full pool for an unassigned rep", () => {
    expect(restrictToAssignedNumbers(POOL, "rep", [])).toEqual(POOL);
    expect(restrictToAssignedNumbers(POOL, "rep", null)).toEqual(POOL);
    expect(restrictToAssignedNumbers(POOL, "rep", undefined)).toEqual(POOL);
  });

  it("fails OPEN to the full pool when an assignment no longer overlaps the live pool", () => {
    // Every assigned number was removed from the pool since assignment.
    expect(restrictToAssignedNumbers(POOL, "rep", ["+19995551234"])).toEqual(POOL);
  });

  it("fails open to the full pool for a missing/unknown role", () => {
    expect(restrictToAssignedNumbers(POOL, null, ["+15550000001"])).toEqual(POOL);
    expect(restrictToAssignedNumbers(POOL, undefined, ["+15550000001"])).toEqual(POOL);
  });

  it("ignores excluded numbers not actually in the pool", () => {
    expect(
      restrictToAssignedNumbers(POOL, "rep", ["+15550000001", "+19995551234"]),
    ).toEqual(["+15550000001"]);
  });
});

describe("planAutoAssignCallerIds", () => {
  const reps = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ memberId: `rep${i + 1}`, existing: [] as string[] }));

  it("deals one number to each rep before giving anyone a second (round-robin, not fill-first)", () => {
    // 3 numbers, 2 reps -> rep1 gets 2 (rounds 1 and 2), rep2 gets 1 (round 1
    // only) -- NOT rep1=2,2 rep2=0,0 or similar front-loading.
    const planned = planAutoAssignCallerIds(POOL, reps(2));
    expect(planned.find((p) => p.memberId === "rep1")?.callerIds).toEqual([
      "+15550000001",
      "+15550000003",
    ]);
    expect(planned.find((p) => p.memberId === "rep2")?.callerIds).toEqual(["+15550000002"]);
  });

  it("caps every rep at MAX_CALLER_IDS_PER_REP, leaving surplus numbers unassigned", () => {
    const bigPool = Array.from({ length: 10 }, (_, i) => `+1555000${String(i).padStart(4, "0")}`);
    const planned = planAutoAssignCallerIds(bigPool, reps(2));
    for (const p of planned) expect(p.callerIds.length).toBeLessThanOrEqual(MAX_CALLER_IDS_PER_REP);
    const totalAssigned = planned.reduce((n, p) => n + p.callerIds.length, 0);
    expect(totalAssigned).toBe(2 * MAX_CALLER_IDS_PER_REP); // both reps maxed out
  });

  it("leaves trailing reps unassigned when there aren't enough numbers to go around", () => {
    const planned = planAutoAssignCallerIds(["+15550000001"], reps(3));
    expect(planned[0].callerIds).toEqual(["+15550000001"]);
    expect(planned[1].callerIds).toEqual([]);
    expect(planned[2].callerIds).toEqual([]);
  });

  it("tops up an existing assignment instead of reshuffling it", () => {
    const withExisting = [
      { memberId: "rep1", existing: ["+15550000002"] }, // already holds the MIDDLE number
      { memberId: "rep2", existing: [] as string[] },
    ];
    const planned = planAutoAssignCallerIds(POOL, withExisting);
    // rep1 keeps +...0002 and gets topped up to 2; rep1's existing number is
    // never reassigned to rep2, and isn't handed out again.
    const rep1 = planned.find((p) => p.memberId === "rep1")!;
    const rep2 = planned.find((p) => p.memberId === "rep2")!;
    expect(rep1.callerIds).toContain("+15550000002");
    expect(rep1.callerIds.length).toBeLessThanOrEqual(MAX_CALLER_IDS_PER_REP);
    expect(rep2.callerIds).not.toContain("+15550000002");
  });

  it("never double-books a number across two reps", () => {
    const planned = planAutoAssignCallerIds(POOL, reps(3));
    const all = planned.flatMap((p) => p.callerIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it("handles an empty pool or an empty rep list without throwing", () => {
    expect(planAutoAssignCallerIds([], reps(2))).toEqual([
      { memberId: "rep1", callerIds: [] },
      { memberId: "rep2", callerIds: [] },
    ]);
    expect(planAutoAssignCallerIds(POOL, [])).toEqual([]);
  });
});
