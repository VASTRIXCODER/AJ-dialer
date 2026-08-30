import {
  BEHAVIOR_TO_OUTCOME,
  resolveDispositionDefs,
  type DispositionBehavior,
  type DispositionDef,
} from "./dispositions/defs";
import type { OrgVocabulary } from "./org/vocabulary";
import type {
  AILiveState,
  CallOutcome,
  CampaignStatus,
  LeadStatus,
  OutcomeOption,
} from "./types";

type Tone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger";

/**
 * What a live call looks like in the Live Monitor.
 *
 * There used to be three of these maps — in ai-live-monitor, in call-dashboard,
 * and in the dashboard's "Live now" card — and they disagreed with each other. The
 * monitor's didn't exist at all: it printed the raw state string with a hardcoded
 * blue badge, so "Initiated" (their phone is ringing) and "In Progress" (they're
 * talking) rendered identically, both with a green "connected" dot and both with a
 * running talk timer. You could not tell, by looking, whether anyone had picked up.
 *
 * One map, one vocabulary, four genuinely distinct states.
 */
export const liveStateConfig: Record<
  AILiveState,
  {
    label: string;
    tone: Tone;
    /** Show the "they're on the line" presence dot? Only when they actually are. */
    live: boolean;
    /** Run the talk timer? Only from the moment of pickup. */
    timer: boolean;
  }
> = {
  initiated: { label: "Calling", tone: "neutral", live: false, timer: false },
  ringing: { label: "Ringing", tone: "warning", live: false, timer: false },
  in_progress: { label: "Connected", tone: "success", live: true, timer: true },
  completed: { label: "Completed", tone: "success", live: false, timer: false },
  failed: { label: "Didn't connect", tone: "danger", live: false, timer: false },
};

export const leadStatusConfig: Record<LeadStatus, { label: string; tone: Tone }> = {
  new: { label: "New", tone: "accent" },
  contacted: { label: "Contacted", tone: "primary" },
  qualified: { label: "Qualified", tone: "success" },
  appointment: { label: "Appointment", tone: "success" },
  callback: { label: "Callback", tone: "warning" },
  not_interested: { label: "Not interested", tone: "neutral" },
  no_answer: { label: "No answer", tone: "neutral" },
  // Neutral default; resolveLeadStatusConfig() swaps in the vertical's wording.
  bills_fine: { label: "No need right now", tone: "warning" },
  dnc: { label: "Do not call", tone: "danger" },
};

export const campaignStatusConfig: Record<
  CampaignStatus,
  { label: string; tone: Tone }
> = {
  active: { label: "Active", tone: "success" },
  paused: { label: "Paused", tone: "warning" },
  completed: { label: "Completed", tone: "neutral" },
};

export const repStatusConfig: Record<
  string,
  { label: string; tone: Tone }
> = {
  on_call: { label: "On call", tone: "success" },
  available: { label: "Available", tone: "accent" },
  wrap_up: { label: "Wrap-up", tone: "warning" },
  break: { label: "Break", tone: "neutral" },
  offline: { label: "Offline", tone: "neutral" },
};

export const outcomeConfig: Record<CallOutcome, { label: string; tone: Tone }> = {
  appointment_booked: { label: "Appointment", tone: "success" },
  callback_scheduled: { label: "Callback", tone: "warning" },
  qualified: { label: "Qualified", tone: "success" },
  not_interested: { label: "Not interested", tone: "neutral" },
  // Vertical-neutral default. `bills_fine` is a solar-era KEY that can't move
  // (it's on historical call records and in every disposition query), but the
  // words a rep reads are resolved per workspace — see resolveOutcomeConfig.
  bills_fine: { label: "No need right now", tone: "warning" },
  no_answer: { label: "No answer", tone: "neutral" },
  voicemail: { label: "Voicemail", tone: "neutral" },
  wrong_number: { label: "Wrong number", tone: "danger" },
  do_not_call: { label: "Do not call", tone: "danger" },
};

/**
 * The outcome labels for a specific workspace. Solar reads "Bills are fine",
 * insurance reads "Happy with current cover", recruiting reads "Not looking
 * right now" — the same stored outcome, in the words that vertical uses.
 *
 * Everything else in the map is already vertical-neutral, so only the one entry
 * moves; callers with no vocabulary in scope keep using `outcomeConfig` and get
 * the neutral default.
 */
export function resolveOutcomeConfig(
  vocabulary?: Pick<OrgVocabulary, "noNeedLabel" | "appointmentNoun"> | null,
): Record<CallOutcome, { label: string; tone: Tone }> {
  if (!vocabulary) return outcomeConfig;
  return {
    ...outcomeConfig,
    bills_fine: {
      ...outcomeConfig.bills_fine,
      label: vocabulary.noNeedLabel || outcomeConfig.bills_fine.label,
    },
  };
}

/**
 * Plain-language descriptions of what each disposition behavior DOES — shown in
 * the Admin editor's behavior select, and as the wrap-up description for custom
 * rows (whose label is the admin's own words, so the description must explain
 * the pipeline effect the label doesn't).
 */
export const BEHAVIOR_DESCRIPTIONS: Record<DispositionBehavior, string> = {
  books_appointment: "Books an appointment",
  schedules_callback: "Schedules a callback",
  marks_dnc: "Suppresses the number forever",
  marks_qualified: "Marks as qualified",
  not_interested: "Marks not interested",
  no_need: "No need right now — revisit later",
  no_answer_retry: "No answer — stays dialable",
  voicemail_retry: "Voicemail left — stays dialable",
  invalid_number: "Flags a bad number",
  neutral_end: "Just ends the call",
};

/**
 * An outcome option plus the disposition KEY that produced it. `value` is
 * ALWAYS a canonical CallOutcome (what gets stored on `call_records.outcome`
 * and what reports query); `key` is the def that was pressed — identical to
 * `value` for the nine system rows, an `x_*` key for admin-created rows.
 */
export type ResolvedOutcomeOption = OutcomeOption & { key: string };

/**
 * The disposition buttons a rep sees at wrap-up, in the workspace's own words.
 *
 * This list used to live in the DEMO seed module (`sample-data.ts`) and shipped
 * to production hardcoded with one vertical's copy: "Account review scheduled",
 * "Homeowner asked to be called back", "Bills are fine". A recruiter closing an
 * interview clicked a button that promised an account review.
 *
 * It is now the org's OWN disposition taxonomy (resolveDispositionDefs over
 * `settings.dispositions`): enabled defs, in the admin's order, with the
 * admin's labels and tones. Called with no settings it renders the canonical
 * nine — exactly the pre-taxonomy behavior, so demo mode and callers with no
 * org in scope never change. The workspace vocabulary still re-words
 * `bills_fine` — unless the admin renamed that row themselves, in which case
 * their wording (the most specific override) wins.
 */
export function resolveOutcomeOptions(
  vocabulary?: Pick<
    OrgVocabulary,
    "leadNoun" | "appointmentNoun" | "noNeedLabel"
  > | null,
  settingsDispositions?: unknown,
): ResolvedOutcomeOption[] {
  const noun = vocabulary?.leadNoun || "lead";
  const appt = vocabulary?.appointmentNoun || "appointment";
  const noNeed = vocabulary?.noNeedLabel || outcomeConfig.bills_fine.label;
  const descriptions: Record<CallOutcome, string> = {
    appointment_booked: `${appt.charAt(0).toUpperCase()}${appt.slice(1)} scheduled`,
    callback_scheduled: `The ${noun} asked to be called back`,
    qualified: "Good fit, continue nurturing",
    not_interested: "Declined further contact",
    bills_fine: "Not now — revisit later",
    no_answer: "Rang out, no pickup",
    voicemail: "Left a voicemail",
    wrong_number: `Number doesn't reach this ${noun}`,
    do_not_call: "Add to the suppression list",
  };
  return resolveDispositionDefs(settingsDispositions)
    .filter((def) => def.enabled)
    .map((def) => {
      // System rows store their own key; custom rows collapse to the canonical
      // outcome their behavior maps to — no new stored outcome values, ever.
      const value = def.system
        ? (def.key as CallOutcome)
        : BEHAVIOR_TO_OUTCOME[def.behavior];
      const label =
        def.key === "bills_fine" && def.label === outcomeConfig.bills_fine.label
          ? noNeed
          : def.label;
      return {
        value,
        key: def.key,
        label,
        description: def.system
          ? descriptions[value]
          : BEHAVIOR_DESCRIPTIONS[def.behavior],
        tone: def.tone,
      };
    });
}

/**
 * Look one disposition up by its stored key — the server-side validator for a
 * client-submitted `dispositionKey`. Null = not in this org's taxonomy.
 */
export function resolveDispositionByKey(
  settingsDispositions: unknown,
  key: string,
): DispositionDef | null {
  if (!key) return null;
  return resolveDispositionDefs(settingsDispositions).find((d) => d.key === key) ?? null;
}

/**
 * Narrow the wrap-up options to a campaign's `disposition_keys` subset. Empty
 * or absent = no narrowing. `do_not_call` always survives the filter — the
 * suppression button is legally load-bearing and no campaign config may hide
 * it (the same invariant resolveDispositionDefs enforces on `enabled`).
 */
export function filterOutcomeOptionsByKeys(
  options: ResolvedOutcomeOption[],
  allowedKeys?: string[] | null,
): ResolvedOutcomeOption[] {
  if (!allowedKeys || allowedKeys.length === 0) return options;
  const allowed = new Set(allowedKeys);
  return options.filter((o) => allowed.has(o.key) || o.key === "do_not_call");
}

/**
 * Lead statuses for a specific workspace — same rule as the outcomes above.
 * `bills_fine` is the only entry with industry-specific wording.
 */
export function resolveLeadStatusConfig(
  vocabulary?: Pick<OrgVocabulary, "noNeedLabel"> | null,
): Record<LeadStatus, { label: string; tone: Tone }> {
  if (!vocabulary) return leadStatusConfig;
  return {
    ...leadStatusConfig,
    bills_fine: {
      ...leadStatusConfig.bills_fine,
      label: vocabulary.noNeedLabel || leadStatusConfig.bills_fine.label,
    },
  };
}
