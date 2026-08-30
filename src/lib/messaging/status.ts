// ─────────────────────────────────────────────────────────────────────────────
// Message lifecycle — PURE. The honest ladder, and the rule that keeps it
// honest when the provider's webhooks arrive out of order.
//
//   draft → needs_approval → approved → queued → sending → sent → delivered
//
// TWO THINGS THIS MODULE EXISTS TO PREVENT:
//
// 1. `sent` written because a send call returned. Twilio's create() returns
//    `queued` or `accepted` — it means "we have it", not "they got it". Writing
//    `sent` there would make every message look delivered the instant it was
//    handed over, which is the single most misleading thing a messaging surface
//    can do.
//
// 2. A late callback demoting a newer one. Twilio does not guarantee ordering,
//    so a `sent` receipt can arrive after `delivered`. Ranked compare-and-set —
//    the same discipline as calls/state-machine.ts — makes that a no-op instead
//    of a downgrade.
//
// And one thing about reading the result: many US carrier routes return `sent`
// and never `delivered` at all. A message parked at `sent` is NOT a failure and
// must never render as one. Sent, delivered and no-receipt are three different
// counts and belong in three different columns.
// ─────────────────────────────────────────────────────────────────────────────

export const MESSAGE_STATUSES = [
  "draft",
  "needs_approval",
  "approved",
  "queued",
  "sending",
  "sent",
  "delivered",
  "undelivered",
  "failed",
  "blocked",
  "rejected",
  "canceled",
  "needs_review",
  "received",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Monotonic progress. A transition is applied only when it raises the rank, so
 * an out-of-order receipt is ignored rather than rewinding the record.
 *
 * `delivered` outranks every other terminal state on purpose: it is the only
 * one that means the message actually arrived, and nothing that arrives later
 * should be able to take that back.
 */
const RANK: Record<MessageStatus, number> = {
  draft: 0,
  needs_approval: 1,
  // Human decisions that end the message. Ranked high so a stray provider
  // callback can never resurrect something a person refused.
  rejected: 90,
  canceled: 90,
  approved: 2,
  queued: 3,
  sending: 4,
  sent: 5,
  undelivered: 6,
  failed: 6,
  delivered: 7,
  // The gate refusing at send time. Terminal, and deliberately NOT `failed` —
  // see BLOCKED_IS_NOT_FAILED below.
  blocked: 80,
  // BELOW every provider outcome, on purpose. This is the "we don't know what
  // happened, ask Twilio" state, so the provider's own answer must be able to
  // clear it. Ranked above `delivered` it did the opposite: once
  // flagStuckMessages moved a slow row here, canAdvanceStatus rejected the
  // delivery receipt it was waiting for, and the state whose copy says a human
  // must resolve it became the one state no receipt could ever resolve.
  //
  // Sitting between `sending` (4) and `sent` (5) means a stuck row can still be
  // flagged, and any later receipt still wins.
  needs_review: 4.5,
  // Inbound messages have no ladder; they arrive and that is that.
  received: 100,
};

export function statusRank(status: string): number {
  return RANK[status as MessageStatus] ?? -1;
}

/** May `from` become `to`? Only when it is genuine forward progress. */
export function canAdvanceStatus(from: string, to: string): boolean {
  const a = statusRank(from);
  const b = statusRank(to);
  if (a < 0 || b < 0) return false;
  return b > a;
}

/**
 * A message stopped by the gate is `blocked`, never `failed`.
 *
 * They are different events and want different reactions: `failed` means
 * something broke and somebody should look; `blocked` means the system
 * correctly declined to contact someone. Filing honoured opt-outs under
 * failures would light the alert every time compliance worked, and the alert
 * would be ignored within a week.
 */
export const BLOCKED_IS_NOT_FAILED = true;

/** Twilio's MessageStatus values → ours. Unknown values change nothing. */
const FROM_TWILIO: Record<string, MessageStatus> = {
  accepted: "queued",
  scheduled: "queued",
  queued: "queued",
  sending: "sending",
  sent: "sent",
  delivered: "delivered",
  undelivered: "undelivered",
  failed: "failed",
  // A carrier-level rejection. Terminal, and a delivery outcome rather than a
  // system fault.
  canceled: "canceled",
};

export function statusFromProvider(providerStatus: string): MessageStatus | null {
  return FROM_TWILIO[String(providerStatus ?? "").toLowerCase()] ?? null;
}

/** Which timestamp column a status writes, if any. */
export function timestampColumnFor(status: MessageStatus): string | null {
  if (status === "queued") return "queued_at";
  if (status === "sent") return "sent_at";
  if (status === "delivered") return "delivered_at";
  return null;
}

/** Statuses that will never change again without human action. */
const TERMINAL = new Set<MessageStatus>([
  "delivered",
  "undelivered",
  "failed",
  "blocked",
  "rejected",
  "canceled",
  "received",
]);

export function isTerminal(status: string): boolean {
  return TERMINAL.has(status as MessageStatus);
}

/** Statuses the drain may pick up. Everything else it must leave alone. */
export function isSendable(status: string): boolean {
  return status === "approved" || status === "queued";
}

export interface MessageStatusCopy {
  label: string;
  detail: string;
  tone: "neutral" | "primary" | "success" | "warning" | "danger";
}

export function messageStatusCopy(status: string): MessageStatusCopy {
  switch (status as MessageStatus) {
    case "draft":
      return { label: "Draft", detail: "Not submitted yet.", tone: "neutral" };
    case "needs_approval":
      return {
        label: "Waiting for approval",
        detail: "Someone needs to read it before it goes.",
        tone: "warning",
      };
    case "approved":
      return { label: "Approved", detail: "Queued to send shortly.", tone: "primary" };
    case "queued":
      return { label: "Queued", detail: "Being handed to the carrier.", tone: "primary" };
    case "sending":
      return { label: "Sending", detail: "The carrier has it.", tone: "primary" };
    case "sent":
      return {
        label: "Sent",
        // The crucial caveat. Without it, every message on a route that never
        // reports delivery looks half-broken forever.
        detail: "Handed to the carrier. Many US routes never confirm delivery beyond this.",
        tone: "success",
      };
    case "delivered":
      return { label: "Delivered", detail: "Confirmed on their handset.", tone: "success" };
    case "undelivered":
      return {
        label: "Not delivered",
        detail: "The carrier could not deliver it.",
        tone: "danger",
      };
    case "failed":
      return { label: "Failed", detail: "It could not be sent.", tone: "danger" };
    case "blocked":
      return {
        label: "Blocked",
        // Reads as protection, not breakage, because that is what it is.
        detail: "Stopped before sending — something changed after it was approved.",
        tone: "warning",
      };
    case "rejected":
      return { label: "Rejected", detail: "Someone decided not to send it.", tone: "neutral" };
    case "canceled":
      return { label: "Canceled", detail: "Called off before it went.", tone: "neutral" };
    case "needs_review":
      return {
        label: "Needs review",
        detail: "Its outcome is unclear and a human has to resolve it.",
        tone: "warning",
      };
    case "received":
      return { label: "Received", detail: "They sent this to us.", tone: "primary" };
    default:
      return { label: status, detail: "", tone: "neutral" };
  }
}

/**
 * SMS has no read receipt. `read_at` on an outbound row means an agent of ours
 * opened the thread, and NOTHING in the product may present it as the customer
 * having read anything. Exported as a named constant so the rule is greppable.
 */
export const SMS_HAS_NO_READ_RECEIPTS = true;
