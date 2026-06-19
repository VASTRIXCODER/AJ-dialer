// ─────────────────────────────────────────────────────────────────────────────
// Data access layer.
//
// By default (production) every collection is EMPTY and metrics are ZERO — the
// app contains no placeholder data. Wire these to your CRM/database, or set
// NEXT_PUBLIC_DEMO_DATA=true to serve the bundled sample data for demos.
//
// Keeping a single gated module means every screen reads from one place.
// ─────────────────────────────────────────────────────────────────────────────

import { DEMO_DATA } from "./demo";
import * as sample from "./sample-data";
import type { MetricSummary, Rep } from "./types";

const EMPTY_METRICS: MetricSummary = {
  totalCalls: 0,
  callsToday: 0,
  connections: 0,
  conversations: 0,
  avgCallLenSec: 0,
  connectRate: 0,
  appointmentRate: 0,
  callbackRate: 0,
  noAnswerRate: 0,
  appointmentsBooked: 0,
  appointmentsCompleted: 0,
  noShows: 0,
  reschedules: 0,
  avgUtilityBill: 0,
  avgSolarPayment: 0,
  avgTotalEnergyCost: 0,
  evOwnership: 0,
  poolOwnership: 0,
  batteryOwnership: 0,
};

// The signed-in user. In production this comes from your auth/session layer;
// here it's a neutral placeholder for "you" (never a fabricated teammate).
const SIGNED_IN_USER: Rep = {
  id: "me",
  name: "Your Account",
  email: "",
  avatarColor: "#F97316",
  initials: "·",
  role: "manager",
  status: "available",
  team: "AIATWORK",
  callsToday: 0,
  conversationsToday: 0,
  appointmentsToday: 0,
  talkTimeMin: 0,
  connectRate: 0,
  score: 0,
};

export const reps = DEMO_DATA ? sample.reps : [];
export const currentRep = DEMO_DATA ? sample.currentRep : SIGNED_IN_USER;
export const leaderboard = DEMO_DATA ? sample.leaderboard : [];
export const leads = DEMO_DATA ? sample.leads : [];
export const campaigns = DEMO_DATA ? sample.campaigns : [];
export const activeCalls = DEMO_DATA ? sample.activeCalls : [];
export const appointments = DEMO_DATA ? sample.appointments : [];
export const callbacks = DEMO_DATA ? sample.callbacks : [];
export const callRecords = DEMO_DATA ? sample.callRecords : [];
export const kpiSeries = DEMO_DATA ? sample.kpiSeries : [];
export const hourlyCalls = DEMO_DATA ? sample.hourlyCalls : [];
export const outcomeBreakdown = DEMO_DATA ? sample.outcomeBreakdown : [];
export const metrics = DEMO_DATA ? sample.metrics : EMPTY_METRICS;

// Disposition options are app configuration (not placeholder data) — always on.
export const outcomeOptions = sample.outcomeOptions;

export function getLeadById(id: string) {
  return DEMO_DATA ? sample.getLeadById(id) : undefined;
}
