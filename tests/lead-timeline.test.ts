import { describe, expect, it } from "vitest";
import {
  mergeTimeline,
  type TimelineItem,
  type TimelineSources,
} from "@/lib/db/lead-timeline";

// ─────────────────────────────────────────────────────────────────────────────
// The Lead 360 timeline's PURE merge — ordering across every source, stability
// on equal timestamps, the before-cursor + cap, and the invariant that a
// rescheduled appointment is ONE item (never a created + rescheduled pair).
// ─────────────────────────────────────────────────────────────────────────────

const T = (h: number) => `2026-08-20T${String(h).padStart(2, "0")}:00:00.000Z`;

function fiveSources(): TimelineSources {
  return {
    lead: { createdAt: T(1), sourceFile: "brokers-aug.csv" },
    callRecords: [
      {
        id: "cr1",
        startedAt: T(8),
        outcome: "no_answer",
        durationSec: 0,
        hasRecording: false,
      },
      {
        id: "cr2",
        startedAt: T(12),
        outcome: "qualified",
        durationSec: 240,
        hasRecording: true,
        conversationId: "conv-a",
        channel: "ai",
      },
    ],
    aiConversations: [
      // Already produced call record cr2 — must NOT appear twice.
      { conversationId: "conv-a", startedAt: T(12), outcome: "qualified" },
      // No record yet — must appear.
      { conversationId: "conv-b", startedAt: T(14), state: "in_progress" },
    ],
    appointments: [
      {
        id: "ap1",
        createdAt: T(13),
        scheduledAt: "2026-08-25T17:00:00.000Z",
        status: "scheduled",
        rescheduledFrom: "2026-08-22T17:00:00.000Z",
      },
    ],
    callbacks: [{ id: "cb1", createdAt: T(6), dueAt: T(20), reason: "after 3pm", status: "due" }],
    leadEvents: [
      {
        id: "ev1",
        createdAt: T(10),
        kind: "status",
        payload: { outcome: "no_answer", to: "no_answer", from: "disposition" },
      },
      {
        id: "ev2",
        createdAt: T(4),
        kind: "assignment",
        payload: { packId: "p1", repId: "r1", count: 50 },
        actorName: "Vic",
      },
    ],
  };
}

describe("mergeTimeline ordering", () => {
  it("merges all five sources newest-first", () => {
    const items = mergeTimeline(fiveSources());
    expect(items.map((i) => i.id)).toEqual([
      "conv-conv-b", // 14
      "appt-ap1", // 13
      "call-cr2", // 12
      "evt-ev1", // 10
      "call-cr1", // 8
      "cb-cb1", // 6
      "evt-ev2", // 4
      "import", // 1
    ]);
    // Every source contributed a distinct kind.
    const kinds = new Set(items.map((i) => i.kind));
    for (const k of ["attempt", "appointment", "callback", "status", "assignment", "import"]) {
      expect(kinds.has(k as TimelineItem["kind"])).toBe(true);
    }
  });

  it("keeps insertion order for identical timestamps (stable)", () => {
    const at = T(9);
    const items = mergeTimeline({
      callRecords: [
        { id: "a", startedAt: at, outcome: null, durationSec: 0, hasRecording: false },
        { id: "b", startedAt: at, outcome: null, durationSec: 0, hasRecording: false },
      ],
      callbacks: [{ id: "c", createdAt: at, dueAt: null, status: "due" }],
      leadEvents: [{ id: "d", createdAt: at, kind: "note", payload: { preview: "x" } }],
    });
    // Source insertion order: callRecords → callbacks → leadEvents.
    expect(items.map((i) => i.id)).toEqual(["call-a", "call-b", "cb-c", "evt-d"]);
  });
});

describe("mergeTimeline paging", () => {
  const manyEvents = (): TimelineSources => ({
    leadEvents: Array.from({ length: 10 }, (_, i) => ({
      id: `e${i}`,
      createdAt: T(10 + i),
      kind: "note" as const,
      payload: {},
    })),
  });

  it("caps at limit, newest first", () => {
    const items = mergeTimeline(manyEvents(), { limit: 3 });
    expect(items.map((i) => i.id)).toEqual(["evt-e9", "evt-e8", "evt-e7"]);
  });

  it("clamps limit to the 200 maximum and a floor of 1", () => {
    expect(mergeTimeline(manyEvents(), { limit: 0 })).toHaveLength(1);
    const big: TimelineSources = {
      leadEvents: Array.from({ length: 250 }, (_, i) => ({
        id: `e${i}`,
        // Spread across minutes so every timestamp is distinct.
        createdAt: `2026-08-20T10:${String(i % 60).padStart(2, "0")}:${String(
          Math.floor(i / 60),
        ).padStart(2, "0")}.000Z`,
        kind: "note" as const,
        payload: {},
      })),
    };
    expect(mergeTimeline(big, { limit: 9999 })).toHaveLength(200);
  });

  it("before-cursor returns STRICTLY older items — no overlap with the prior page", () => {
    const sources = manyEvents();
    const first = mergeTimeline(sources, { limit: 4 });
    const cursor = first[first.length - 1].at; // e6's timestamp
    const older = mergeTimeline(sources, { before: cursor, limit: 4 });
    expect(older.map((i) => i.id)).toEqual(["evt-e5", "evt-e4", "evt-e3", "evt-e2"]);
    // Nothing repeats across the two pages.
    const ids = new Set(first.map((i) => i.id));
    for (const item of older) expect(ids.has(item.id)).toBe(false);
  });
});

describe("mergeTimeline appointments", () => {
  it("renders a rescheduled appointment as ONE item carrying its history", () => {
    const items = mergeTimeline({
      appointments: [
        {
          id: "ap1",
          createdAt: T(9),
          scheduledAt: "2026-08-25T17:00:00.000Z",
          status: "scheduled",
          rescheduledFrom: "2026-08-22T17:00:00.000Z",
          cancelReason: null,
        },
      ],
    });
    const appts = items.filter((i) => i.kind === "appointment");
    expect(appts).toHaveLength(1);
    expect(appts[0].detail).toContain("rescheduled from");
    expect(appts[0].refs?.appointmentId).toBe("ap1");
  });

  it("a cancelled appointment is one struck item, not a second entry", () => {
    const items = mergeTimeline({
      appointments: [
        {
          id: "ap2",
          createdAt: T(9),
          scheduledAt: null,
          status: "cancelled",
          cancelReason: "Re-dispositioned as not interested",
        },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Appointment cancelled");
    expect(items[0].detail).toContain("Re-dispositioned as not interested");
  });
});

describe("mergeTimeline de-duplication and labels", () => {
  it("skips AI conversations that already produced a call record", () => {
    const items = mergeTimeline(fiveSources());
    expect(items.filter((i) => i.id === "conv-conv-a")).toHaveLength(0);
    expect(items.filter((i) => i.id === "call-cr2")).toHaveLength(1);
  });

  it("uses provided vocabulary labels for outcomes and statuses", () => {
    const items = mergeTimeline(
      {
        callRecords: [
          { id: "c1", startedAt: T(5), outcome: "bills_fine", durationSec: 60, hasRecording: false },
        ],
        leadEvents: [
          { id: "e1", createdAt: T(6), kind: "status", payload: { to: "bills_fine", from: "new" } },
        ],
      },
      {
        outcomeLabels: { bills_fine: "Happy with current cover" },
        statusLabels: { bills_fine: "Happy with current cover", new: "New" },
      },
    );
    expect(items.find((i) => i.id === "call-c1")?.title).toBe(
      "Call — Happy with current cover",
    );
    expect(items.find((i) => i.id === "evt-e1")?.title).toBe(
      "Status → Happy with current cover",
    );
  });

  it("falls back to neutral labels when no vocabulary is supplied", () => {
    const items = mergeTimeline({
      callRecords: [
        { id: "c1", startedAt: T(5), outcome: "bills_fine", durationSec: 0, hasRecording: false },
      ],
    });
    expect(items[0].title).toBe("Call — No need right now");
  });
});
