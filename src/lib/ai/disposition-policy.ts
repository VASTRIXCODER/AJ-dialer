// ─────────────────────────────────────────────────────────────────────────────
// AI disposition policy — PURE module (no server-only, no I/O), so the
// decision logic that governs whether an AI-proposed disposition may touch a
// call record is unit-testable and importable from settings (which is itself
// isomorphic).
//
// The stakes: before F1, a low-confidence AI disposition applied SILENTLY —
// the model's guess and a human's verdict were indistinguishable on the
// record. This module is the one place that decides, deterministically, which
// of three things happens to a proposal:
//
//   auto_apply — write the key onto the record, but ONLY into a null slot
//                (an existing value, human or AI, is never overwritten);
//   review     — file a call_review_queue row for a person to adjudicate;
//   none       — record the artifact and do nothing else.
// ─────────────────────────────────────────────────────────────────────────────

export interface AiDispositionPolicy {
  /** Minimum confidence (0..1) for silent application. Below it → review. */
  autoApplyMin: number;
  /**
   * Outcome keys that must ALWAYS get a human look no matter how confident the
   * model is — compliance-grade dispositions (do_not_call suppresses a number
   * forever; a hallucinated one silences a real prospect).
   */
  alwaysReview: string[];
  /**
   * A proposal with no transcript behind it has no checkable evidence — send
   * it to review rather than applying words nobody can verify.
   */
  reviewOnMissingTranscript: boolean;
}

export const DEFAULT_AI_DISPOSITION_POLICY: AiDispositionPolicy = {
  autoApplyMin: 0.8,
  alwaysReview: ["do_not_call"],
  reviewOnMissingTranscript: true,
};

/**
 * Sanitize a stored (partial / hand-edited) policy blob over the defaults.
 * Arrays replace wholesale — spread-merging would resurrect an entry an admin
 * just deleted. autoApplyMin is clamped into [0, 1]: a blob saying "80" means
 * 80%, and 0.8 is the closest honest reading we can give a clamp (values > 1
 * collapse to 1 = "never auto-apply silently", the SAFE direction).
 */
export function mergeAiDispositionPolicy(raw: unknown): AiDispositionPolicy {
  const s = (raw ?? {}) as Partial<AiDispositionPolicy>;
  const min = Number(s.autoApplyMin);
  return {
    autoApplyMin: Number.isFinite(min)
      ? Math.min(1, Math.max(0, min))
      : DEFAULT_AI_DISPOSITION_POLICY.autoApplyMin,
    alwaysReview: Array.isArray(s.alwaysReview)
      ? s.alwaysReview.filter((k): k is string => typeof k === "string" && k.length > 0)
      : [...DEFAULT_AI_DISPOSITION_POLICY.alwaysReview],
    reviewOnMissingTranscript:
      typeof s.reviewOnMissingTranscript === "boolean"
        ? s.reviewOnMissingTranscript
        : DEFAULT_AI_DISPOSITION_POLICY.reviewOnMissingTranscript,
  };
}

/** The reasons the ANALYZER may file — `rep_flagged` is a client claim, never ours. */
export type AiReviewReason = "low_confidence" | "high_impact" | "missing_transcript";

export type DispositionDecision =
  | { action: "auto_apply" }
  | { action: "review"; reason: AiReviewReason }
  | {
      action: "none";
      why: "agrees_with_current" | "already_dispositioned" | "no_review_policy";
    };

/**
 * Decide what an AI-proposed disposition may do to a call record.
 *
 * Order matters and each rule is load-bearing:
 *
 *  1. The record already carries the proposed key → nothing to do (the AI
 *     agreeing with what's filed is confirmation, not news).
 *  2. The record already carries a DIFFERENT value → never overwrite. The only
 *     disagreement worth a human's time is a high-impact one (the model heard
 *     "take me off your list" and the filed key says otherwise) — anything
 *     else would put every manual call with a chatty note into the queue.
 *  3. No transcript → no checkable evidence. Review when the policy says so;
 *     otherwise do nothing (an unverifiable proposal must never auto-apply).
 *  4. High-impact outcome → always a human, however confident the model.
 *  5. Confidence below the bar → review.
 *  6. Confident, evidenced, benign, and the slot is empty → auto-apply.
 */
export function decideDispositionAction(input: {
  /** The proposal's confidence, 0..1. */
  confidence: number;
  /** The canonical outcome the proposed key lands on (policy matches on this). */
  outcome: string;
  /** The disposition KEY being proposed (what auto-apply would write). */
  proposedKey: string;
  /** Does a real transcript back this proposal? */
  hasTranscript: boolean;
  /** call_records.disposition as it stands right now (null = never filed). */
  currentDisposition: string | null;
  policy: AiDispositionPolicy;
}): DispositionDecision {
  const { policy } = input;
  const highImpact =
    policy.alwaysReview.includes(input.outcome) ||
    policy.alwaysReview.includes(input.proposedKey);

  if (input.currentDisposition != null) {
    if (input.currentDisposition === input.proposedKey) {
      return { action: "none", why: "agrees_with_current" };
    }
    return highImpact
      ? { action: "review", reason: "high_impact" }
      : { action: "none", why: "already_dispositioned" };
  }

  if (!input.hasTranscript) {
    return policy.reviewOnMissingTranscript
      ? { action: "review", reason: "missing_transcript" }
      : { action: "none", why: "no_review_policy" };
  }

  if (highImpact) return { action: "review", reason: "high_impact" };

  if (!(input.confidence >= policy.autoApplyMin)) {
    return { action: "review", reason: "low_confidence" };
  }

  return { action: "auto_apply" };
}

/**
 * May an AI writer replace an artifact from this source? The override chain's
 * one hard rule: an AI writer may NEVER supersede a source='human' row — once
 * a person has corrected an artifact, no re-analysis takes their words back.
 * (The reverse is always allowed: humans supersede AI freely.)
 */
export function aiMaySupersede(existingSource: "ai" | "human" | null): boolean {
  return existingSource !== "human";
}
