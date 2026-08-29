import { describe, expect, it } from "vitest";
import type { PresencePayload } from "@/lib/realtime/events";
import {
  mergeFloor,
  STALE_AFTER_MS,
} from "@/lib/realtime/floor-merge";

const NOW = 1_756_000_000_000;

function claim(
  userId: string,
  status: PresencePayload["status"],
  over: Partial<PresencePayload> = {},
): PresencePayload {
  return { userId, name: `User ${userId}`, status, statusSince: NOW - 5_000, ...over };
}

describe("mergeFloor — webhook truth beats the claim", () => {
  it("a live connected call overrides a self-reported 'available'", () => {
    const rows = mergeFloor({
      presence: [claim("u1", "available")],
      liveCalls: [{ ownerId: "u1", state: "connected", leadName: "Dana", at: NOW - 2_000 }],
      aiActive: [],
      now: NOW,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: "u1", status: "connected", leadName: "Dana" });
  });

  it("a ringing call overrides a claimed 'paused' as dialing", () => {
    const rows = mergeFloor({
      presence: [claim("u2", "paused")],
      liveCalls: [{ ownerId: "u2", state: "ringing", at: NOW }],
      aiActive: [],
      now: NOW,
    });
    expect(rows[0].status).toBe("dialing");
  });

  it("a claimed 'dialing' with NO live call behind it downgrades to available", () => {
    const rows = mergeFloor({
      presence: [claim("u3", "dialing")],
      liveCalls: [],
      aiActive: [],
      now: NOW,
    });
    expect(rows[0].status).toBe("available");
  });

  it("an honest claim with no call stands (wrapup stays wrapup)", () => {
    const rows = mergeFloor({
      presence: [claim("u4", "wrapup")],
      liveCalls: [],
      aiActive: [],
      now: NOW,
    });
    expect(rows[0]).toMatchObject({ userId: "u4", status: "wrapup", statusSince: NOW - 5_000 });
  });
});

describe("mergeFloor — offline", () => {
  it("a roster member absent from presence with no live call is offline", () => {
    const rows = mergeFloor({
      presence: [],
      liveCalls: [],
      aiActive: [],
      now: NOW,
      roster: [{ userId: "u5", name: "Silent Sam" }],
    });
    expect(rows).toEqual([
      expect.objectContaining({ userId: "u5", name: "Silent Sam", status: "offline" }),
    ]);
  });

  it("a roster member with a live call is NOT offline — the call wins", () => {
    const rows = mergeFloor({
      presence: [],
      liveCalls: [{ ownerId: "u6", state: "calling", at: NOW }],
      aiActive: [],
      now: NOW,
      roster: [{ userId: "u6", name: "Riley" }],
    });
    expect(rows[0]).toMatchObject({ userId: "u6", name: "Riley", status: "dialing" });
  });
});

describe("mergeFloor — staleness", () => {
  it("flags a non-terminal call whose last event is older than 30s", () => {
    const rows = mergeFloor({
      presence: [],
      liveCalls: [{ ownerId: "u7", state: "connected", at: NOW - STALE_AFTER_MS - 1 }],
      aiActive: [],
      now: NOW,
    });
    expect(rows[0].stale).toBe(true);
  });

  it("a call heard from within 30s is not stale", () => {
    const rows = mergeFloor({
      presence: [],
      liveCalls: [{ ownerId: "u7", state: "connected", at: NOW - STALE_AFTER_MS + 1 }],
      aiActive: [],
      now: NOW,
    });
    expect(rows[0].stale).toBe(false);
  });

  it("a call with no event timestamp cannot be judged stale", () => {
    const rows = mergeFloor({
      presence: [],
      liveCalls: [{ ownerId: "u7", state: "ringing" }],
      aiActive: [],
      now: NOW,
    });
    expect(rows[0].stale).toBe(false);
  });
});

describe("mergeFloor — AI activity", () => {
  it("counts a user's in-flight AI conversations and ranks them 'ai'", () => {
    const rows = mergeFloor({
      presence: [claim("u8", "available")],
      liveCalls: [],
      aiActive: [{ ownerId: "u8" }, { ownerId: "u8" }, { ownerId: "u9" }],
      now: NOW,
    });
    const u8 = rows.find((r) => r.userId === "u8");
    const u9 = rows.find((r) => r.userId === "u9");
    expect(u8).toMatchObject({ status: "ai", aiActiveCount: 2 });
    expect(u9).toMatchObject({ status: "ai", aiActiveCount: 1 });
  });

  it("a live HUMAN call still wins over AI activity, but keeps the AI count", () => {
    const rows = mergeFloor({
      presence: [],
      liveCalls: [{ ownerId: "u10", state: "connected", at: NOW }],
      aiActive: [{ ownerId: "u10" }],
      now: NOW,
    });
    expect(rows[0]).toMatchObject({ status: "connected", aiActiveCount: 1 });
  });

  it("unattributable calls (no ownerId) are skipped, not misassigned", () => {
    const rows = mergeFloor({
      presence: [],
      liveCalls: [{ ownerId: null, state: "connected", at: NOW }],
      aiActive: [{ ownerId: null }],
      now: NOW,
    });
    expect(rows).toHaveLength(0);
  });
});

describe("mergeFloor — output shape", () => {
  it("emits exactly one row per user, busiest first", () => {
    const rows = mergeFloor({
      presence: [claim("idle1", "available"), claim("busy1", "available")],
      liveCalls: [
        { ownerId: "busy1", state: "connected", at: NOW },
        { ownerId: "busy1", state: "ringing", at: NOW },
      ],
      aiActive: [],
      now: NOW,
      roster: [{ userId: "off1", name: "Offline Olly" }],
    });
    expect(rows.map((r) => r.userId)).toEqual(["busy1", "idle1", "off1"]);
    // Connected beats a second ringing line for the same user.
    expect(rows[0].status).toBe("connected");
  });
});
