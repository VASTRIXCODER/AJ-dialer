import type { ChannelRow } from "./call-analytics";
import type { CostRates } from "./org/settings";

// ─────────────────────────────────────────────────────────────────────────────
// Call cost estimates — a PURE module (no DB, no server-only) so it's testable
// and reusable: talk time × the org's per-minute rates, split by channel.
// Deliberately labeled "estimated" everywhere it renders: carriers bill in
// per-minute increments with per-number fees this deliberately ignores, so the
// figure tracks spend closely without pretending to be an invoice.
// ─────────────────────────────────────────────────────────────────────────────

export interface ChannelCost {
  channel: "ai" | "human";
  label: string;
  calls: number;
  /** Talk time in whole minutes (rounded for display). */
  minutes: number;
  /** Estimated spend in USD, rounded to cents. */
  cost: number;
}

export interface CostBreakdown {
  /** Estimated total spend across both channels, USD. */
  totalCost: number;
  perChannel: ChannelCost[];
  appointments: number;
  /** totalCost / appointments — null when nothing was booked in the window. */
  costPerAppointment: number | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function costBreakdown(channels: ChannelRow[], rates: CostRates): CostBreakdown {
  const perChannel: ChannelCost[] = channels.map((ch) => {
    const perMinute = ch.channel === "ai" ? rates.aiPerMinute : rates.manualPerMinute;
    const minutes = ch.totalTalkSec / 60;
    return {
      channel: ch.channel,
      label: ch.label,
      calls: ch.calls,
      minutes: Math.round(minutes),
      cost: cents(minutes * Math.max(0, perMinute)),
    };
  });
  const totalCost = cents(perChannel.reduce((a, c) => a + c.cost, 0));
  const appointments = channels.reduce((a, c) => a + c.appointments, 0);
  return {
    totalCost,
    perChannel,
    appointments,
    costPerAppointment: appointments > 0 ? cents(totalCost / appointments) : null,
  };
}
