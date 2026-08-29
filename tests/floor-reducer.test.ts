import { describe, expect, it } from "vitest";
import type { CallStatePayload } from "@/lib/realtime/events";
import { STALE_AFTER_MS } from "@/lib/realtime/floor-merge";
import {
  applyCallState,
  callsFromSnapshot,
  floorCallKey,
  isStaleCall,
  reconcileWithSnapshot,
  type FloorCallMap,
  type SnapshotAiCall,
  type SnapshotHumanCall,
} from "@/lib/realtime/floor-reducer";

const NOW = 1_756_000_000_000;

let seq = 0;
function event(over: Partial<CallStatePayload> & Pick<CallStatePayload, "kind" | "id" | "state">): CallStatePayload {
  return {
    seq: ++seq,
    at: new Date(NOW).toISOString(),
    ownerId: null,
    leadId: null,
    leadName: "",
    campaignId: null,
    ...over,
  };
}

function human(over: Partial<SnapshotHumanCall> = {}): SnapshotHumanCall {
  return {
    id: "hc-1",
    ownerId: "u1",
    repName: "Dana Rep",
    leadName: "Alex Lead",
    city: "Fresno",
    phone: "+15550001111",
    state: "connected",
    startedAt: NOW - 60_000,
    connectedAt: NOW - 45_000,
    canListen: true,
    ...over,
  };
}

function ai(over: Partial<SnapshotAiCall> = {}): SnapshotAiCall {
  return {
    conversationId: "conv-1",
    ownerId: "u2",
    repName: "Sam Rep",
    leadId: "lead-9",
    leadName: "Bo Lead",
    phone: "+15550002222",
    city: "Dallas",
    state: "in_progress",
    startedAt: NOW - 30_000,
    ringingAt: NOW - 25_000,
    connectedAt: NOW - 20_000,
    campaignId: "camp-1",
    campaignName: "Spring push",
    ...over,
  };
}

describe("applyCallState — the call.state event reducer", () => {
  it("upserts a new call from its first event", () => {
    const map = applyCallState(
      new Map(),
      event({ kind: "human", id: "hc-1", state: "calling", ownerId: "u1", leadName: "Alex" }),
      NOW,
    );
    const call = map.get(floorCallKey("human", "hc-1"));
    expect(call).toMatchObject({
      kind: "human",
      id: "hc-1",
      ownerId: "u1",
      leadName: "Alex",
      state: "calling",
      connectedAt: null,
    });
  });

  it("advances calling → ringing → connected and stamps connectedAt ONCE", () => {
    let map: FloorCallMap = new Map();
    map = applyCallState(map, event({ kind: "human", id: "hc-1", state: "calling" }), NOW);
    map = applyCallState(
      map,
      event({
        kind: "human",
        id: "hc-1",
        state: "connected",
        stateSince: new Date(NOW + 5_000).toISOString(),
        at: new Date(NOW + 5_000).toISOString(),
      }),
      NOW + 5_000,
    );
    const first = map.get(floorCallKey("human", "hc-1"));
    expect(first?.state).toBe("connected");
    expect(first?.connectedAt).toBe(NOW + 5_000);
    expect(first?.canListen).toBe(true);

    // A duplicate "connected" must not restart the talk timer.
    map = applyCallState(
      map,
      event({
        kind: "human",
        id: "hc-1",
        state: "connected",
        stateSince: new Date(NOW + 9_000).toISOString(),
        at: new Date(NOW + 9_000).toISOString(),
      }),
      NOW + 9_000,
    );
    expect(map.get(floorCallKey("human", "hc-1"))?.connectedAt).toBe(NOW + 5_000);
  });

  it("a late lower-rank event refreshes liveness but never drags the state back", () => {
    let map: FloorCallMap = new Map();
    map = applyCallState(
      map,
      event({
        kind: "human",
        id: "hc-1",
        state: "connected",
        at: new Date(NOW).toISOString(),
      }),
      NOW,
    );
    map = applyCallState(
      map,
      event({
        kind: "human",
        id: "hc-1",
        state: "ringing",
        at: new Date(NOW + 3_000).toISOString(),
      }),
      NOW + 3_000,
    );
    const call = map.get(floorCallKey("human", "hc-1"));
    expect(call?.state).toBe("connected");
    expect(call?.lastEventAt).toBe(NOW + 3_000);
  });

  it("'ended' removes the call; ending an unknown call returns the SAME map", () => {
    let map: FloorCallMap = new Map();
    map = applyCallState(map, event({ kind: "ai", id: "conv-1", state: "connected" }), NOW);
    map = applyCallState(map, event({ kind: "ai", id: "conv-1", state: "ended" }), NOW + 1);
    expect(map.size).toBe(0);

    const same = applyCallState(map, event({ kind: "ai", id: "ghost", state: "ended" }), NOW);
    expect(same).toBe(map);
  });
});

describe("callsFromSnapshot — hydration", () => {
  it("maps human + AI rows (initiated→calling, in_progress→connected)", () => {
    const map = callsFromSnapshot([human()], [ai(), ai({ conversationId: "conv-2", state: "initiated", connectedAt: null })], NOW);
    expect(map.size).toBe(3);
    expect(map.get("human:hc-1")).toMatchObject({
      kind: "human",
      state: "connected",
      stateSince: NOW - 45_000, // connectedAt, not startedAt
      canListen: true,
      repName: "Dana Rep",
    });
    expect(map.get("ai:conv-1")).toMatchObject({
      kind: "ai",
      state: "connected",
      campaignName: "Spring push",
      leadId: "lead-9",
    });
    expect(map.get("ai:conv-2")).toMatchObject({ state: "calling", stateSince: NOW - 30_000 });
  });
});

describe("reconcileWithSnapshot — AI + human merge, per call, by timestamp", () => {
  it("the snapshot replaces stale event entries AND repairs a missed 'ended'", () => {
    const snapAt = NOW;
    // Event-fed board: one human call last heard about BEFORE the snapshot cut.
    let prev: FloorCallMap = new Map();
    prev = applyCallState(
      prev,
      event({ kind: "human", id: "gone", state: "connected", at: new Date(NOW - 10_000).toISOString() }),
      NOW - 10_000,
    );
    const snap = callsFromSnapshot([human()], [ai()], snapAt);
    const merged = reconcileWithSnapshot(prev, snap, snapAt);
    // "gone" is absent from the snapshot and older than it: dropped.
    expect(merged.has("human:gone")).toBe(false);
    expect(merged.has("human:hc-1")).toBe(true);
    expect(merged.has("ai:conv-1")).toBe(true);
  });

  it("an event NEWER than the snapshot wins its call, enriched with snapshot fields", () => {
    const snapAt = NOW;
    let prev: FloorCallMap = new Map();
    prev = applyCallState(
      prev,
      event({
        kind: "ai",
        id: "conv-1",
        state: "connected",
        at: new Date(NOW + 2_000).toISOString(),
        stateSince: new Date(NOW + 2_000).toISOString(),
      }),
      NOW + 2_000,
    );
    const snap = callsFromSnapshot([], [ai({ state: "ringing", connectedAt: null })], snapAt);
    const merged = reconcileWithSnapshot(prev, snap, snapAt);
    const call = merged.get("ai:conv-1");
    // Event lifecycle survives (connected, not the snapshot's ringing)…
    expect(call?.state).toBe("connected");
    // …but the snapshot's display fields fill what the event never carried.
    expect(call?.campaignName).toBe("Spring push");
    expect(call?.repName).toBe("Sam Rep");
  });

  it("an event-born call the snapshot hasn't caught up to is kept", () => {
    const snapAt = NOW;
    let prev: FloorCallMap = new Map();
    prev = applyCallState(
      prev,
      event({ kind: "human", id: "brand-new", state: "calling", at: new Date(NOW + 500).toISOString() }),
      NOW + 500,
    );
    const merged = reconcileWithSnapshot(prev, callsFromSnapshot([], [], snapAt), snapAt);
    expect(merged.has("human:brand-new")).toBe(true);
  });
});

describe("isStaleCall — stale computation at a fixed clock", () => {
  it("flips exactly past STALE_AFTER_MS of silence", () => {
    const base = callsFromSnapshot([human()], [], NOW).get("human:hc-1")!;
    expect(isStaleCall({ ...base, lastEventAt: NOW - STALE_AFTER_MS }, NOW)).toBe(false);
    expect(isStaleCall({ ...base, lastEventAt: NOW - STALE_AFTER_MS - 1 }, NOW)).toBe(true);
  });
});
