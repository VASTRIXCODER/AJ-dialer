import type { LeadStatus } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Dial segments — WHICH leads a session is allowed to call, and how deliberately.
//
// The dialer used to hardcode `DIALABLE = ["new", "no_answer", "callback"]`, so
// five statuses could never be dialed at all. A homeowner who booked an
// appointment and then no-showed was unreachable forever: their status is
// `appointment`, which isn't in the list, so they silently fell out of every
// queue with no way back short of editing the database.
//
// The fix is NOT to widen the allowlist — dialing a `dnc` lead is a legal
// problem, and blanket-redialing `not_interested` is a good way to get a number
// flagged. The fix is to make the choice EXPLICIT: three tiers, where the
// operator opts in to anything beyond the safe default, and `dnc` can never be
// selected at all.
// ─────────────────────────────────────────────────────────────────────────────

export type SegmentTier = "default" | "optin" | "blocked";

export interface SegmentDef {
  key: LeadStatus;
  label: string;
  tier: SegmentTier;
  /** Shown on the card. For opt-in tiers this is a warning, not a description. */
  hint: string;
}

export const SEGMENTS: SegmentDef[] = [
  {
    key: "new",
    label: "Never called",
    tier: "default",
    hint: "Fresh leads that have never been dialed.",
  },
  {
    key: "no_answer",
    label: "No answer",
    tier: "default",
    hint: "Dialed but nobody picked up — safe to re-attempt.",
  },
  {
    key: "callback",
    label: "Callback due",
    tier: "default",
    hint: "The homeowner asked to be called back.",
  },
  {
    key: "contacted",
    label: "Contacted",
    tier: "optin",
    hint: "Already spoken to. Re-dialing may annoy them — select deliberately.",
  },
  {
    key: "qualified",
    label: "Qualified",
    tier: "optin",
    hint: "Already qualified. Usually a rep follow-up, not an AI re-dial.",
  },
  {
    key: "appointment",
    label: "Appointment set",
    tier: "optin",
    hint: "Has a booked appointment. Use for confirmation or no-show recovery only.",
  },
  {
    key: "bills_fine",
    label: "Bills are fine",
    tier: "optin",
    hint: "Said their bills are fine. Only re-dial on a new offer or after months.",
  },
  {
    key: "not_interested",
    label: "Not interested",
    tier: "optin",
    hint: "Explicitly declined. Re-dialing risks complaints and number flagging.",
  },
  {
    key: "dnc",
    label: "Do not call",
    tier: "blocked",
    hint: "Legally protected. These can never be dialed.",
  },
];

/** Safe by default — what a fresh session pre-selects. */
export const DEFAULT_SEGMENTS: LeadStatus[] = SEGMENTS.filter(
  (s) => s.tier === "default",
).map((s) => s.key);

/** Selectable, but only on purpose. */
export const OPT_IN_SEGMENTS: LeadStatus[] = SEGMENTS.filter(
  (s) => s.tier === "optin",
).map((s) => s.key);

/** Never dialable, under any selection. Enforced server-side, not just in the UI. */
export const BLOCKED_SEGMENTS: LeadStatus[] = SEGMENTS.filter(
  (s) => s.tier === "blocked",
).map((s) => s.key);

export const segmentInfo = (key: string): SegmentDef =>
  SEGMENTS.find((s) => s.key === key) ?? {
    key: key as LeadStatus,
    label: key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
    tier: "optin",
    hint: "",
  };

/**
 * Strip anything the operator isn't allowed to dial. Applied SERVER-SIDE when a
 * session is materialised, so a hand-crafted request can't sneak a `dnc` lead
 * into a queue by bypassing the UI.
 */
export function sanitizeSegments(requested: string[]): LeadStatus[] {
  const blocked = new Set<string>(BLOCKED_SEGMENTS);
  const known = new Set<string>(SEGMENTS.map((s) => s.key));
  const out = requested.filter((s) => known.has(s) && !blocked.has(s)) as LeadStatus[];
  return out.length ? out : [...DEFAULT_SEGMENTS];
}

/** Contact-state axis. Orthogonal to status — they AND together. */
export type ContactFilter = "any" | "never" | "contacted";

/** How to order the session queue. */
export type SessionOrder = "ai_score" | "oldest" | "least_recent";

export const ORDER_LABELS: Record<SessionOrder, string> = {
  ai_score: "Best leads first (AI score)",
  oldest: "Oldest leads first",
  least_recent: "Least recently contacted first",
};

/** What a session is: the exact, replayable definition of who gets called. */
export interface SessionSpec {
  statuses: LeadStatus[];
  contact: ContactFilter;
  order: SessionOrder;
  /** Hard cap on how many leads this session will dial. */
  limit: number;
  /** Optional: only these campaigns. */
  campaignId?: string | null;
  /** Optional: an explicit hand-picked set, bypassing the segment filters. */
  leadIds?: string[];
}
