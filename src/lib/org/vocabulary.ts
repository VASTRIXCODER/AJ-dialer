// ─────────────────────────────────────────────────────────────────────────────
// Workspace vocabulary — the ONE place that answers "what does this org call a
// contact, a booked meeting, or a call that went nowhere?"
//
// PURE + isomorphic (no DB, no server-only), so a Server Component, a Client
// Component and the AI layer all read the same words. Three separate
// implementations of this precedence used to exist (the leads page, the AI org
// context, and a scattering of literal "homeowner" strings), and they disagreed:
// the same workspace could be told it had "policyholders" on one screen and
// "homeowners" on the next.
//
// The product began as a solar dialer, so solar's nouns were written straight
// into shared screens. Solar is now one vertical among many: it keeps its exact
// wording, and every other vertical gets its own instead of borrowing solar's.
// ─────────────────────────────────────────────────────────────────────────────

import { templateProfile } from "./templates";
import { DEFAULT_ORG_SETTINGS } from "./settings";
import { brandTagline, isSolarVertical } from "./vertical";

/**
 * The minimal org shape this derives from — structurally satisfied by
 * `Viewer["org"]` and by the raw organization rows the AI/webhook paths carry.
 */
export interface VocabularySource {
  dialerTemplate?: string | null;
  productName?: string | null;
  settings?: {
    leadNoun?: string;
    leadNounPlural?: string;
  } | null;
}

export interface OrgVocabulary {
  /** The org's vertical, e.g. "solar", "insurance". */
  template: string;
  isSolar: boolean;
  /** "homeowner" / "policyholder" / "lead" — lowercase, mid-sentence. */
  leadNoun: string;
  leadNounPlural: string;
  /** Same nouns, capitalized — column headers, empty-state titles, labels. */
  LeadNoun: string;
  LeadNounPlural: string;
  /** What a booked meeting is called here: "account review", "showing", "interview". */
  appointmentNoun: string;
  appointmentNounPlural: string;
  /**
   * Label for the `bills_fine` disposition. The stored key is fixed (it is on
   * thousands of historical call records), but "Bills are fine" is a sentence
   * only a solar rep would ever say — every other vertical reads its own.
   */
  noNeedLabel: string;
  /** Subtitle under the wordmark. */
  tagline: string;
}

/** "homeowner" → "Homeowner"; leaves an already-capitalized noun alone. */
function capitalize(word: string): string {
  return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
}

/**
 * Resolve an org's vocabulary. `null` (no org row — demo mode, or a webhook that
 * couldn't resolve one) yields the neutral general vertical rather than solar's:
 * an unknown workspace must not inherit another industry's language.
 */
export function orgVocabulary(
  org: VocabularySource | null | undefined,
): OrgVocabulary {
  const template = String(org?.dialerTemplate || "general");
  const profile = templateProfile(template);

  // The org's own noun wins — but `mergeSettings` back-fills the seed default
  // ("lead"/"leads") for every workspace, so presence alone can't be the test.
  // A stored value equal to the seed means "never chose one", and falls through
  // to the vertical's noun; anything else is a deliberate admin choice.
  const stored = (org?.settings?.leadNoun ?? "").trim();
  const storedPlural = (org?.settings?.leadNounPlural ?? "").trim();
  const leadNoun =
    stored && stored !== DEFAULT_ORG_SETTINGS.leadNoun ? stored : profile.leadNoun;
  const leadNounPlural =
    storedPlural && storedPlural !== DEFAULT_ORG_SETTINGS.leadNounPlural
      ? storedPlural
      : profile.leadNounPlural;

  const appointmentNoun = profile.appointmentNoun ?? "appointment";
  return {
    template,
    isSolar: isSolarVertical(template),
    leadNoun,
    leadNounPlural,
    LeadNoun: capitalize(leadNoun),
    LeadNounPlural: capitalize(leadNounPlural),
    appointmentNoun,
    appointmentNounPlural:
      profile.appointmentNounPlural ?? `${appointmentNoun}s`,
    noNeedLabel: profile.noNeedLabel ?? "No need right now",
    tagline: brandTagline(template, org?.productName),
  };
}

/** The vocabulary a screen falls back to when no org is in scope at all. */
export const DEFAULT_VOCABULARY: OrgVocabulary = orgVocabulary(null);
