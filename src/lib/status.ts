import type { CallOutcome, LeadStatus } from "./types";

type Tone = "neutral" | "primary" | "accent" | "success" | "warning" | "danger";

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
