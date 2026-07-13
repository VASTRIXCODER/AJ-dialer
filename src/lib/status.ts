import type { AILiveState, CallOutcome, LeadStatus } from "./types";

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
  bills_fine: { label: "Bills are fine", tone: "warning" },
  dnc: { label: "Do not call", tone: "danger" },
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
  bills_fine: { label: "Bills are fine", tone: "warning" },
  no_answer: { label: "No answer", tone: "neutral" },
  voicemail: { label: "Voicemail", tone: "neutral" },
  wrong_number: { label: "Wrong number", tone: "danger" },
  do_not_call: { label: "Do not call", tone: "danger" },
};
