// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for legal-document versions. Bump a version here
// whenever the corresponding document changes materially — the signup
// checkbox, the acceptance record, and the document pages all read from this
// file, so a bump is what makes "require re-acceptance for material changes"
// actually happen (existing acceptance rows stay pinned to the old version).
// ─────────────────────────────────────────────────────────────────────────────

export const TERMS_VERSION = "1.0";
export const TERMS_EFFECTIVE_DATE = "[MONTH DAY, YEAR]";

export const PRIVACY_VERSION = "pending";
export const AUP_VERSION = "pending";

/**
 * Bump this when the campaign-certification questions themselves change (not
 * when an org's campaigns change) — every org must re-certify against the new
 * version before dialing again.
 */
export const CAMPAIGN_CERT_VERSION = "1.0";

/** The exact clickwrap label shown next to the signup checkbox. Stored verbatim
 *  with each acceptance so the record proves exactly what was agreed to. */
export const SIGNUP_ACCEPTANCE_TEXT =
  "I have read and agree to the AIATWORK Terms of Service, Privacy Policy, and Acceptable Use Policy. " +
  "I understand that I am solely responsible for my calling campaigns, contact lists, consent records, " +
  "scripts, opt-outs, and compliance with all applicable telemarketing laws.";

/** The exact certification shown before a campaign/list can be used to dial. */
export const CAMPAIGN_CERT_TEXT =
  "I certify that I have the legal right to contact the numbers in this campaign, that the campaign is " +
  "configured for lawful business purposes, and that I will honor all consent, identification, opt-out, " +
  "suppression, Do Not Call, calling-hour, recording, artificial-voice, and other applicable requirements.";
