// ─────────────────────────────────────────────────────────────────────────────
// The Live Floor's call reducer — PURE (no I/O; unit-tested in
// tests/floor-reducer.test.ts; floor-board.tsx consumes it).
//
// Two inputs describe the org's live calls and they interleave freely:
//   • `call.state` broadcasts — instant doorbells, may arrive out of order and
//     may be MISSED entirely (serverless publisher, reconnects)
//   • the /api/floor/snapshot poll — authoritative but seconds old
// The rules, mirrored from the rest of the pipeline:
//   1. State only moves FORWARD within a call (a late "ringing" can't drag a
//      connected call backwards — the same monotonic rule the stores enforce).
//   2. "ended" removes the call from the board (the snapshot's absence agrees).
//   3. A snapshot replaces the board EXCEPT for calls an event touched AFTER
//      the snapshot was cut — the fresher signal wins, per call, by timestamp.
//   4. Staleness = silence: a live call nobody has heard about for
//      STALE_AFTER_MS is rendered hedged, not asserted (STALE badge).
// ─────────────────────────────────────────────────────────────────────────────

import type { CallStatePayload } from "./events";
import { STALE_AFTER_MS } from "./floor-merge";

/** A live (non-terminal) call as the floor board renders it. */
export interface FloorCall {
  key: string; // `${kind}:${id}` — one entry per provider call
  kind: "human" | "ai";
  /** humanId (manual conference) or conversationId (AI). */
  id: string;
  ownerId: string | null;
  repName: string;
  leadId: string | null;
  leadName: string;
  phone: string;
  city: string;
  campaignId: string | null;
  campaignName: string;
  state: "calling" | "ringing" | "connected";
  /** ms epoch — when the call entered `state` (drives the ticking timer). */
  stateSince: number;
  /** ms epoch — the last signal (event or snapshot) about this call. */
  lastEventAt: number;
  /** ms epoch — they picked up (stamped once; never reset by later signals). */
  connectedAt: number | null;
  /** Human calls only: the conference exists once connected → listenable. */
  canListen: boolean;
}

export type FloorCallMap = Map<string, FloorCall>;

export function floorCallKey(kind: "human" | "ai", id: string): string {
  return `${kind}:${id}`;
}

const STATE_RANK: Record<FloorCall["state"], number> = {
  calling: 0,
  ringing: 1,
  connected: 2,
};

/** Event-payload state → board state (terminal "ended" handled by the caller). */
function eventState(s: CallStatePayload["state"]): FloorCall["state"] | null {
  if (s === "calling") return "calling";
  if (s === "ringing") return "ringing";
  if (s === "connected") return "connected";
  return null; // "ended"
}

/**
 * Apply one `call.state` broadcast. Returns a NEW map when anything changed and
 * the SAME map otherwise, so React state updates are cheap to short-circuit.
 */
export function applyCallState(
  map: FloorCallMap,
  p: CallStatePayload,
  now: number,
): FloorCallMap {
  if (!p?.id || (p.kind !== "human" && p.kind !== "ai")) return map;
  const key = floorCallKey(p.kind, p.id);

  if (p.state === "ended") {
    if (!map.has(key)) return map;
    const next = new Map(map);
    next.delete(key);
    return next;
  }

  const state = eventState(p.state);
  if (!state) return map;

  const at = p.at ? Date.parse(p.at) : NaN;
  const eventAt = Number.isFinite(at) ? at : now;
  const since = p.stateSince ? Date.parse(p.stateSince) : NaN;
  const stateSince = Number.isFinite(since) ? since : eventAt;

  const prev = map.get(key);
  const next = new Map(map);
  if (!prev) {
    next.set(key, {
      key,
      kind: p.kind,
      id: p.id,
      ownerId: p.ownerId ?? null,
      repName: "",
      leadId: p.leadId ?? null,
      leadName: p.leadName ?? "",
      phone: "",
      city: "",
      campaignId: p.campaignId ?? null,
      campaignName: "",
      state,
      stateSince,
      lastEventAt: eventAt,
      connectedAt: state === "connected" ? stateSince : null,
      canListen: p.kind === "human" && state === "connected",
    });
    return next;
  }

  // Monotonic: a late lower-rank event refreshes liveness but not the state.
  const advances = STATE_RANK[state] > STATE_RANK[prev.state];
  next.set(key, {
    ...prev,
    ownerId: p.ownerId ?? prev.ownerId,
    leadId: p.leadId ?? prev.leadId,
    leadName: p.leadName || prev.leadName,
    campaignId: p.campaignId ?? prev.campaignId,
    state: advances ? state : prev.state,
    stateSince: advances ? stateSince : prev.stateSince,
    lastEventAt: Math.max(prev.lastEventAt, eventAt),
    // Stamped once — a duplicate "connected" can't restart the talk timer.
    connectedAt:
      prev.connectedAt ?? (state === "connected" ? stateSince : null),
    canListen:
      prev.kind === "human" && (advances ? state : prev.state) === "connected",
  });
  return next;
}

// ── Snapshot hydration ───────────────────────────────────────────────────────

/** /api/floor/snapshot `humans[]` row (live_calls, org-scoped). */
export interface SnapshotHumanCall {
  id: string;
  ownerId: string | null;
  repName: string;
  leadName: string;
  city: string;
  phone: string;
  state: "calling" | "ringing" | "connected";
  startedAt: number;
  connectedAt: number | null;
  canListen: boolean;
}

/** /api/floor/snapshot `ai[]` row (merged live AI set, org-scoped). */
export interface SnapshotAiCall {
  conversationId: string;
  ownerId: string | null;
  repName: string;
  leadId: string | null;
  leadName: string;
  phone: string;
  city: string;
  /** AILiveState live subset. */
  state: "initiated" | "ringing" | "in_progress";
  startedAt: number;
  ringingAt: number | null;
  connectedAt: number | null;
  campaignId: string | null;
  campaignName: string;
}

const AI_TO_BOARD: Record<SnapshotAiCall["state"], FloorCall["state"]> = {
  initiated: "calling",
  ringing: "ringing",
  in_progress: "connected",
};

/** Build the board map a snapshot describes, stamped at `snapAt`. */
export function callsFromSnapshot(
  humans: SnapshotHumanCall[],
  ai: SnapshotAiCall[],
  snapAt: number,
): FloorCallMap {
  const map: FloorCallMap = new Map();
  for (const h of humans) {
    if (!h?.id) continue;
    const key = floorCallKey("human", h.id);
    map.set(key, {
      key,
      kind: "human",
      id: h.id,
      ownerId: h.ownerId ?? null,
      repName: h.repName ?? "",
      leadId: null,
      leadName: h.leadName ?? "",
      phone: h.phone ?? "",
      city: h.city ?? "",
      campaignId: null,
      campaignName: "",
      state: h.state,
      stateSince:
        h.state === "connected" ? (h.connectedAt ?? h.startedAt) : h.startedAt,
      lastEventAt: snapAt,
      connectedAt: h.connectedAt ?? null,
      canListen: Boolean(h.canListen),
    });
  }
  for (const a of ai) {
    if (!a?.conversationId) continue;
    const key = floorCallKey("ai", a.conversationId);
    const state = AI_TO_BOARD[a.state] ?? "calling";
    map.set(key, {
      key,
      kind: "ai",
      id: a.conversationId,
      ownerId: a.ownerId ?? null,
      repName: a.repName ?? "",
      leadId: a.leadId ?? null,
      leadName: a.leadName ?? "",
      phone: a.phone ?? "",
      city: a.city ?? "",
      campaignId: a.campaignId ?? null,
      campaignName: a.campaignName ?? "",
      state,
      stateSince:
        state === "connected"
          ? (a.connectedAt ?? a.startedAt)
          : state === "ringing"
            ? (a.ringingAt ?? a.startedAt)
            : a.startedAt,
      lastEventAt: snapAt,
      connectedAt: a.connectedAt ?? null,
      canListen: false,
    });
  }
  return map;
}

/**
 * Fold a fresh snapshot into the event-fed board. Per call, the NEWER signal
 * wins: a call the events touched after the snapshot was cut keeps its event
 * state (enriched with the snapshot's richer fields); everything else takes the
 * snapshot's word — including disappearing, which is how a missed "ended"
 * broadcast is repaired.
 */
export function reconcileWithSnapshot(
  prev: FloorCallMap,
  snap: FloorCallMap,
  snapAt: number,
): FloorCallMap {
  const next: FloorCallMap = new Map(snap);
  for (const [key, call] of prev) {
    if (call.lastEventAt <= snapAt) continue; // snapshot is the fresher truth
    const s = next.get(key);
    if (!s) {
      // Event-born call the snapshot hasn't caught up to yet.
      next.set(key, call);
      continue;
    }
    // Keep the event's lifecycle, fill display fields the event never carries.
    next.set(key, {
      ...call,
      repName: call.repName || s.repName,
      leadId: call.leadId ?? s.leadId,
      leadName: call.leadName || s.leadName,
      phone: call.phone || s.phone,
      city: call.city || s.city,
      campaignId: call.campaignId ?? s.campaignId,
      campaignName: call.campaignName || s.campaignName,
      connectedAt: call.connectedAt ?? s.connectedAt,
    });
  }
  return next;
}

/**
 * True when a live call has gone quiet for longer than STALE_AFTER_MS — the
 * card hedges (amber STALE badge) instead of asserting a live call.
 */
export function isStaleCall(call: FloorCall, now: number): boolean {
  return now - call.lastEventAt > STALE_AFTER_MS;
}
