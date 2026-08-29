// ─────────────────────────────────────────────────────────────────────────────
// Consent — PURE. No I/O, importable from Server and Client Components alike.
//
// This is the module that decides whether we are allowed to contact someone,
// and its most important behaviour is what it does with NOTHING: a number with
// no consent row is `unknown`, and unknown is treated exactly like `revoked`.
//
// That is not caution for its own sake. The existing book was imported without
// recorded provenance, so for almost every number in it the honest answer to
// "did they agree to this?" is "we don't know". Defaulting unknown to permitted
// would turn 37,000 unanswered questions into 37,000 assumed yeses, and the
// first time anyone asked us to prove one we would have nothing to show.
//
// Consent is NOT the Do-Not-Call list and neither replaces the other:
//   • DNC is suppression — "never contact this number", whoever they are.
//   • Consent is permission — "they said yes, and here is what they said".
// A number can be absent from DNC and still have no consent. Both must pass.
// ─────────────────────────────────────────────────────────────────────────────

export const CONSENT_CHANNELS = ["sms", "voice", "email"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/**
 * What they agreed to. Promotional is the superset: someone who opted in to
 * marketing may obviously also be sent a confirmation about the appointment
 * they booked. The reverse is never true, and the ladder below is the only
 * place that asymmetry is expressed.
 */
export const CONSENT_SCOPES = ["transactional", "promotional"] as const;
export type ConsentScope = (typeof CONSENT_SCOPES)[number];

const SCOPE_RANK: Record<ConsentScope, number> = {
  transactional: 0,
  promotional: 1,
};

export type ConsentStatus = "granted" | "revoked" | "unknown";

export interface ConsentSnapshot {
  status: ConsentStatus;
  /** Null when unknown — there is no scope on a permission nobody gave. */
  scope: ConsentScope | null;
  source: string;
  capturedAt: string | null;
}

/** The state of a number we have never heard anything about. */
export const UNKNOWN_CONSENT: ConsentSnapshot = {
  status: "unknown",
  scope: null,
  source: "",
  capturedAt: null,
};

/**
 * May we send something of `required` scope to this number?
 *
 * `unknown` returns false for BOTH scopes, including transactional. It is
 * tempting to allow a transactional reply to someone we know nothing about,
 * but the inbound message that would justify it records its own transactional
 * grant first — so by the time a reply is composed the state is `granted`, not
 * `unknown`. Leaving unknown permissive would only ever help a send that has no
 * inbound behind it, which is exactly the send that must not go.
 */
export function consentPermits(
  snapshot: ConsentSnapshot | null | undefined,
  required: ConsentScope,
): boolean {
  const snap = snapshot ?? UNKNOWN_CONSENT;
  if (snap.status !== "granted" || !snap.scope) return false;
  return SCOPE_RANK[snap.scope] >= SCOPE_RANK[required];
}

/** Why a send was refused on consent grounds. Null when consent permits it. */
export type ConsentDenial = "no_consent" | "consent_revoked" | "consent_scope";

export function consentDenial(
  snapshot: ConsentSnapshot | null | undefined,
  required: ConsentScope,
): ConsentDenial | null {
  const snap = snapshot ?? UNKNOWN_CONSENT;
  if (snap.status === "revoked") return "consent_revoked";
  if (snap.status === "unknown" || !snap.scope) return "no_consent";
  // Granted, but for less than this send needs.
  if (SCOPE_RANK[snap.scope] < SCOPE_RANK[required]) return "consent_scope";
  return null;
}

/** Operator-facing copy. These strings are shown verbatim on the send gate. */
export const CONSENT_DENIAL_COPY: Record<ConsentDenial, string> = {
  no_consent:
    "No recorded permission to message this number. Capture consent on a call, or wait for them to text first.",
  consent_revoked: "They asked to stop receiving messages.",
  consent_scope:
    "They agreed to messages about their own appointment, not to marketing.",
};

/**
 * How a grant was captured. The source matters for what may later undo it:
 * a customer's own START may lift their own STOP, but not a Do-Not-Call a rep
 * recorded from a phone conversation. Same asymmetry as CUSTOMER_REVERSIBLE_
 * SOURCES on the suppression list, for the same reason.
 */
export const CONSENT_SOURCES = [
  "inbound_sms",
  "call_wrapup",
  "web_form",
  "import",
  "manual",
] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];

export function isConsentSource(v: unknown): v is ConsentSource {
  return typeof v === "string" && (CONSENT_SOURCES as readonly string[]).includes(v);
}

export const CONSENT_SOURCE_LABEL: Record<ConsentSource, string> = {
  inbound_sms: "They texted us first",
  call_wrapup: "Agreed on a call",
  web_form: "Submitted a form",
  import: "Recorded at import",
  manual: "Entered by hand",
};

/**
 * Short human status for a record view. Deliberately does NOT say "no consent"
 * for unknown — the two are different facts and conflating them would have a
 * rep believe someone declined when nobody ever asked.
 */
export function consentSummary(snapshot: ConsentSnapshot | null | undefined): {
  label: string;
  tone: "neutral" | "success" | "warning" | "danger";
  detail: string;
} {
  const snap = snapshot ?? UNKNOWN_CONSENT;
  if (snap.status === "revoked") {
    return {
      label: "Opted out",
      tone: "danger",
      detail: "They asked us to stop. Only they can undo this.",
    };
  }
  if (snap.status === "unknown") {
    return {
      label: "Not recorded",
      tone: "warning",
      // The distinction that matters: nobody said no, nobody asked.
      detail: "Nobody has captured permission to message this number yet.",
    };
  }
  return snap.scope === "promotional"
    ? {
        label: "Opted in",
        tone: "success",
        detail: "Agreed to messages, including offers.",
      }
    : {
        label: "Replies only",
        tone: "neutral",
        detail: "We may answer them, but not send marketing.",
      };
}
