import { describe, expect, it } from "vitest";
import {
  assignmentLane,
  classifyLeadBucket,
  deriveDueFlags,
  planAllocationLeadIds,
  remainingCount,
  summarizeProgress,
  workedCount,
} from "@/lib/assignments/plan";
import { can } from "@/lib/permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Assignment planning (Phase 1 · D1) — the pure derivations behind the
// Assignment Center's buckets, the rep lanes, and the allocation source.
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyLeadBucket()", () => {
  it("maps every canonical status to exactly one bucket", () => {
    expect(classifyLeadBucket("new", null)).toBe("untouched");
    expect(classifyLeadBucket("callback")).toBe("callback");
    expect(classifyLeadBucket("appointment")).toBe("appointment");
    expect(classifyLeadBucket("dnc")).toBe("dnc");
    expect(classifyLeadBucket("qualified")).toBe("completed");
    expect(classifyLeadBucket("not_interested")).toBe("completed");
    // Stored key, never a vertical's wording — bills_fine is a contract.
    expect(classifyLeadBucket("bills_fine")).toBe("completed");
    expect(classifyLeadBucket("contacted")).toBe("inProgress");
    expect(classifyLeadBucket("no_answer")).toBe("inProgress");
  });

  it('extends lead-pack-assign\'s "worked": a contacted "new" lead is NOT untouched', () => {
    expect(classifyLeadBucket("new", "2026-08-01T10:00:00Z")).toBe("inProgress");
  });

  it("treats an unknown status as in-progress rather than losing the lead", () => {
    expect(classifyLeadBucket("someday_new_status")).toBe("inProgress");
  });
});

describe("summarizeProgress()", () => {
  const fixture = [
    { status: "new", lastContactedAt: null }, // untouched
    { status: "new", lastContactedAt: null }, // untouched
    { status: "new", lastContactedAt: "2026-08-01T00:00:00Z" }, // inProgress
    { status: "no_answer", lastContactedAt: "2026-08-02T00:00:00Z" }, // inProgress
    { status: "callback", lastContactedAt: "2026-08-02T00:00:00Z" }, // callback
    { status: "appointment", lastContactedAt: "2026-08-03T00:00:00Z" }, // appointment
    { status: "qualified", lastContactedAt: "2026-08-03T00:00:00Z" }, // completed
    { status: "bills_fine", lastContactedAt: "2026-08-03T00:00:00Z" }, // completed
    { status: "dnc", lastContactedAt: null }, // dnc
  ];

  it("buckets are mutually exclusive and sum to total", () => {
    const p = summarizeProgress(fixture);
    expect(p).toEqual({
      total: 9,
      untouched: 2,
      inProgress: 2,
      callback: 1,
      appointment: 1,
      dnc: 1,
      completed: 2,
    });
    expect(
      p.untouched + p.inProgress + p.callback + p.appointment + p.dnc + p.completed,
    ).toBe(p.total);
  });

  it("worked and remaining derive from the buckets", () => {
    const p = summarizeProgress(fixture);
    expect(workedCount(p)).toBe(7); // everything that left untouched
    expect(remainingCount(p)).toBe(5); // untouched + inProgress + callback
  });

  it("an empty pack is all zeros", () => {
    const p = summarizeProgress([]);
    expect(p.total).toBe(0);
    expect(workedCount(p)).toBe(0);
    expect(remainingCount(p)).toBe(0);
  });
});

describe("deriveDueFlags()", () => {
  const now = new Date("2026-08-28T12:00:00Z");

  it("flags an active pack past its due date as overdue", () => {
    expect(deriveDueFlags("2026-08-27T00:00:00Z", "active", now).overdue).toBe(true);
    expect(deriveDueFlags("2026-08-27T00:00:00Z", "paused", now).overdue).toBe(true);
  });

  it("flags due-soon inside 48h, not beyond", () => {
    expect(deriveDueFlags("2026-08-29T12:00:00Z", "active", now)).toEqual({
      overdue: false,
      dueSoon: true,
    });
    expect(deriveDueFlags("2026-09-15T00:00:00Z", "active", now)).toEqual({
      overdue: false,
      dueSoon: false,
    });
  });

  it("a completed or archived pack is never overdue — the flag is about work at risk", () => {
    expect(deriveDueFlags("2026-01-01T00:00:00Z", "completed", now).overdue).toBe(false);
    expect(deriveDueFlags("2026-01-01T00:00:00Z", "archived", now).overdue).toBe(false);
  });

  it("no date / garbage date raises nothing", () => {
    expect(deriveDueFlags(null, "active", now)).toEqual({ overdue: false, dueSoon: false });
    expect(deriveDueFlags("not-a-date", "active", now)).toEqual({
      overdue: false,
      dueSoon: false,
    });
  });
});

describe("assignmentLane()", () => {
  it("lanes by status, with overdue jumping the active lane", () => {
    expect(assignmentLane("active", false)).toBe("active");
    expect(assignmentLane("active", true)).toBe("overdue");
    expect(assignmentLane("paused", true)).toBe("paused"); // paused wins — it isn't being worked
    expect(assignmentLane("completed", false)).toBe("completed");
    expect(assignmentLane("archived", false)).toBe("completed");
  });
});

describe("planAllocationLeadIds()", () => {
  it("the pool passes null — the RPC's own eligibility scan decides", () => {
    expect(planAllocationLeadIds("pool", null)).toEqual({ ok: true, leadIds: null });
    // Even if a caller accidentally resolved ids for the pool, they're ignored.
    expect(planAllocationLeadIds("pool", ["a", "b"])).toEqual({ ok: true, leadIds: null });
  });

  it("filter / smart-list sources pass their resolved ids through", () => {
    expect(planAllocationLeadIds("filter", ["id-1", "id-2"])).toEqual({
      ok: true,
      leadIds: ["id-1", "id-2"],
    });
    expect(planAllocationLeadIds("smart_list", ["id-9"])).toEqual({
      ok: true,
      leadIds: ["id-9"],
    });
  });

  it("an EMPTY resolution is a hard stop, never a silent widen to null", () => {
    const filter = planAllocationLeadIds("filter", []);
    expect(filter.ok).toBe(false);
    const smart = planAllocationLeadIds("smart_list", null);
    expect(smart.ok).toBe(false);
  });
});

describe("assignments.manage permission", () => {
  it("is held by manager+ and not by reps (override still wins)", () => {
    expect(can("owner", "assignments.manage")).toBe(true);
    expect(can("admin", "assignments.manage")).toBe(true);
    expect(can("manager", "assignments.manage")).toBe(true);
    expect(can("rep", "assignments.manage")).toBe(false);
    expect(can("rep", "assignments.manage", { "assignments.manage": true })).toBe(true);
  });
});
