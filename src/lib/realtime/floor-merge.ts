// ─────────────────────────────────────────────────────────────────────────────
// The floor merge rule — PURE (no I/O; unit-tested in tests/floor-merge.test.ts;
// the Live Floor UI consumes it in E2).
//
// Two sources describe what a rep is doing, and they can disagree:
//   • presence — what the rep's BROWSER claims (channel.track / heartbeat)
//   • calls    — what the PROVIDER proved (Twilio/ElevenLabs webhooks →
//                live_calls / ai_conversations / call.state events)
// The rule, everywhere and always: webhook truth beats the claim. A crashed tab
// can keep claiming "available" through a whole call; a webhook cannot claim a
// call that isn't happening. This is exactly the inversion of the old roster,
// where a crashed tab showed "Live" until its 45s heartbeat window aged out.
// ─────────────────────────────────────────────────────────────────────────────

import type { PresencePayload } from "./events";

/** A webhook-driven human call, as the floor sees it. */
export interface FloorLiveCall {
  ownerId: string | null;
  state: "calling" | "ringing" | "connected";
  leadName?: string;
  /** ms epoch — when the call entered its current state. */
  since?: number;
  /** ms epoch — the LAST event we heard about this call (drives `stale`). */
  at?: number;
}

/** An in-flight AI conversation, attributed to the rep who launched it. */
export interface FloorAiCall {
  ownerId: string | null;
}

/** A known org member, so silence can be rendered as "offline" by name. */
export interface FloorRosterEntry {
  userId: string;
  name: string;
}

export type FloorStatus =
  | "offline"
  | "available"
  | "paused"
  | "wrapup"
  | "dialing"
  | "connected"
  | "ai";

export interface FloorPresenceRow {
  userId: string;
  name: string;
  /** The merged, truthful status — a proven call always beats the claim. */
  status: FloorStatus;
  /** ms epoch — when `status` began (best available signal). */
  statusSince: number;
  leadName: string;
  aiActiveCount: number;
  /**
   * True when the winning signal is a NON-TERMINAL call whose last event is
   * older than STALE_AFTER_MS — the webhook stream may have gone quiet, so the
   * UI should hedge ("last seen…") instead of asserting a live call.
   */
  stale: boolean;
}

/** A live call that hasn't been heard from in this long is suspect. */
export const STALE_AFTER_MS = 30_000;

export interface MergeFloorInput {
  /** Self-reported channel presence (values of the presence Map). */
  presence: Iterable<PresencePayload>;
  /** Webhook-driven human calls (live_calls). */
  liveCalls: FloorLiveCall[];
  /** In-flight AI conversations. */
  aiActive: FloorAiCall[];
  now: number;
  /**
   * Known org members. Anyone here who is absent from presence AND has no live
   * call renders as offline — the floor shows the whole team, not just the
   * browsers that happen to be reporting.
   */
  roster?: FloorRosterEntry[];
}

/** live_calls state → floor status ("calling"/"ringing" are both dialing). */
function callStatus(state: FloorLiveCall["state"]): FloorStatus {
  return state === "connected" ? "connected" : "dialing";
}

/**
 * Merge presence claims, live human calls, and AI activity into one row per
 * user. Deterministic and total: every userId seen in any input appears exactly
 * once in the output (calls with no ownerId can't be attributed and are
 * skipped — they still show on the calls board, just not on a person).
 */
export function mergeFloor(input: MergeFloorInput): FloorPresenceRow[] {
  const { now } = input;

  const claims = new Map<string, PresencePayload>();
  for (const p of input.presence) {
    if (p?.userId) claims.set(p.userId, p);
  }

  // One human call per user is the norm; on a conflict prefer connected over
  // dialing (a rep bridged on line 1 while line 2 rings out is "connected").
  const calls = new Map<string, FloorLiveCall>();
  for (const c of input.liveCalls) {
    if (!c.ownerId) continue;
    const prev = calls.get(c.ownerId);
    if (!prev || (c.state === "connected" && prev.state !== "connected")) {
      calls.set(c.ownerId, c);
    }
  }

  const aiCounts = new Map<string, number>();
  for (const a of input.aiActive) {
    if (!a.ownerId) continue;
    aiCounts.set(a.ownerId, (aiCounts.get(a.ownerId) ?? 0) + 1);
  }

  const names = new Map<string, string>();
  for (const r of input.roster ?? []) names.set(r.userId, r.name);
  for (const p of claims.values()) if (!names.has(p.userId)) names.set(p.userId, p.name);

  const userIds = new Set<string>([
    ...names.keys(),
    ...claims.keys(),
    ...calls.keys(),
    ...aiCounts.keys(),
  ]);

  const rows: FloorPresenceRow[] = [];
  for (const userId of userIds) {
    const claim = claims.get(userId);
    const call = calls.get(userId);
    const aiActiveCount = aiCounts.get(userId) ?? 0;
    const name = names.get(userId) ?? "Teammate";

    if (call) {
      // Webhook truth wins outright — whatever the browser claims.
      rows.push({
        userId,
        name,
        status: callStatus(call.state),
        statusSince: call.since ?? claim?.statusSince ?? now,
        leadName: call.leadName ?? "",
        aiActiveCount,
        stale: call.at != null && now - call.at > STALE_AFTER_MS,
      });
    } else if (aiActiveCount > 0) {
      // AI lines in flight are also provider-proven activity.
      rows.push({
        userId,
        name,
        status: "ai",
        statusSince: claim?.statusSince ?? now,
        leadName: "",
        aiActiveCount,
        stale: false,
      });
    } else if (claim) {
      // No proven call: the claim stands — but a claimed "dialing"/"ai" with no
      // call behind it downgrades to available (the claim outlived its call).
      const status: FloorStatus =
        claim.status === "dialing" || claim.status === "ai" ? "available" : claim.status;
      rows.push({
        userId,
        name,
        status,
        statusSince: claim.statusSince,
        leadName: "",
        aiActiveCount: 0,
        stale: false,
      });
    } else {
      // Known to the roster, silent everywhere else: offline.
      rows.push({
        userId,
        name,
        status: "offline",
        statusSince: now,
        leadName: "",
        aiActiveCount: 0,
        stale: false,
      });
    }
  }

  // Busiest first, then by name — the order a supervisor scans the floor in.
  const RANK: Record<FloorStatus, number> = {
    connected: 0,
    dialing: 1,
    ai: 2,
    wrapup: 3,
    available: 4,
    paused: 5,
    offline: 6,
  };
  return rows.sort(
    (a, b) => RANK[a.status] - RANK[b.status] || a.name.localeCompare(b.name),
  );
}
