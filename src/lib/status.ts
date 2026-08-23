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
 * The disposition buttons a rep sees at wrap-up, in the workspace's own words.
 *
 * This list used to live in the DEMO seed module (`sample-data.ts`) and shipped
 * to production hardcoded with one vertical's copy: "Account review scheduled",
 * "Homeowner asked to be called back", "Bills are fine". A recruiter closing an
 * interview clicked a button that promised an account review.
 */
export function resolveOutcomeOptions(
  vocabulary?: Pick<
    OrgVocabulary,
    "leadNoun" | "appointmentNoun" | "noNeedLabel"
  > | null,
): OutcomeOption[] {
  const noun = vocabulary?.leadNoun || "lead";
  const appt = vocabulary?.appointmentNoun || "appointment";
  const noNeed = vocabulary?.noNeedLabel || outcomeConfig.bills_fine.label;
  return [
    {
      value: "appointment_booked",
      label: "Appointment booked",
      description: `${appt.charAt(0).toUpperCase()}${appt.slice(1)} scheduled`,
      tone: "success",
    },
    {
      value: "callback_scheduled",
      label: "Callback",
      description: `The ${noun} asked to be called back`,
      tone: "warning",
    },
    {
      value: "qualified",
      label: "Qualified",
      description: "Good fit, continue nurturing",
      tone: "success",
    },
    {
      value: "not_interested",
      label: "Not interested",
      description: "Declined further contact",
      tone: "neutral",
    },
    {
      value: "bills_fine",
      label: noNeed,
      description: "Not now — revisit later",
      tone: "warning",
    },
    {
      value: "no_answer",
      label: "No answer",
      description: "Rang out, no pickup",
      tone: "neutral",
    },
    {
      value: "voicemail",
      label: "Voicemail",
      description: "Left a voicemail",
      tone: "neutral",
    },
    {
      value: "wrong_number",
      label: "Wrong number",
      description: `Number doesn't reach this ${noun}`,
      tone: "danger",
    },
    {
      value: "do_not_call",
      label: "Do not call",
      description: "Add to the suppression list",
      tone: "danger",
    },
  ];
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
