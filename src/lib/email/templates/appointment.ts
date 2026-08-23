// ─────────────────────────────────────────────────────────────────────────────
// The "an appointment was set" email. PURE — no server-only, no DB, no fetch —
// so the verify script can render and assert on it without sending anything.
//
// This is written for someone who is about to drive to a stranger's house. The
// thing they need first is WHEN and WHERE, then WHO and their phone number, then
// the qualifying numbers that explain why we're going at all. Everything else is
// noise. Inline styles + a table layout, because that's what email clients
// actually render — no external CSS, no webfonts, no images.
//
// The time ALWAYS carries its timezone. Appointments are stored as floating wall
// clock (see src/lib/appointments/time.ts), so "6:00 PM" on its own is genuinely
// ambiguous to a reader in another state — and this email is precisely the moment
// it leaves the app and reaches one.
// ─────────────────────────────────────────────────────────────────────────────

import {
  DEFAULT_DURATION_MIN,
  formatDayLabel,
  formatRange,
  parseFloating,
  timezoneLabel,
} from "../../appointments/time";
import { formatCurrency, formatPhone } from "../../utils";

export type AppointmentEmailKind =
  | "appointment_set"
  | "appointment_rescheduled"
  | "appointment_cancelled";

/** The snapshot the DB trigger writes into notification_outbox.payload. */
export interface AppointmentEmailPayload {
  appointmentId?: string;
  leadName?: string;
  scheduledAt?: string | null;
  previousAt?: string | null;
  scheduledLabel?: string;
  durationMin?: number;
  timezone?: string;
  location?: string;
  notes?: string;
  source?: string;
  status?: string;
  cancelReason?: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  utilityBill?: number | null;
  solarPayment?: number | null;
  utilityProvider?: string;
  /**
   * The workspace's own words, so the email doesn't tell a recruiting team that
   * a "Homeowner" booked an "account review". Absent ⇒ neutral defaults, which
   * is what a caller that predates this field gets.
   */
  leadNoun?: string;
  moneyLabels?: { primary?: string; secondary?: string };
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface RenderContext {
  kind: AppointmentEmailKind;
  payload: AppointmentEmailPayload;
  /** Display name of the rep who booked it. */
  repName?: string;
  orgName?: string;
  /** Base URL so the CTA is clickable — falls back to no link when absent. */
  appUrl?: string;
}

const esc = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "Tue, Jul 14 · 6:00 – 7:00 PM CDT" — or the AI's own words when there's no timestamp. */
export function whenSentence(p: AppointmentEmailPayload): string {
  const start = parseFloating(p.scheduledAt ?? null);
  if (!start) {
    return p.scheduledLabel?.trim() || "No specific time agreed — call to confirm";
  }
  const tz = timezoneLabel(p.timezone || "", start);
  const range = formatRange(start, p.durationMin || DEFAULT_DURATION_MIN);
  return `${formatDayLabel(start)} · ${range}${tz ? ` ${tz}` : ""}`;
}

function addressLine(p: AppointmentEmailPayload): string {
  if (p.location?.trim()) return p.location.trim();
  return p.address?.trim() || "";
}

const SUBJECTS: Record<AppointmentEmailKind, string> = {
  appointment_set: "Appointment set",
  appointment_rescheduled: "Appointment moved",
  appointment_cancelled: "Appointment cancelled",
};

const HEADLINES: Record<AppointmentEmailKind, string> = {
  appointment_set: "New account review booked",
  appointment_rescheduled: "An account review moved",
  appointment_cancelled: "An account review was cancelled",
};

const ACCENTS: Record<AppointmentEmailKind, string> = {
  appointment_set: "#16a34a",
  appointment_rescheduled: "#d97706",
  appointment_cancelled: "#dc2626",
};

interface Field {
  label: string;
  value: string;
}

function fields(ctx: RenderContext): Field[] {
  const { payload: p, kind } = ctx;
  const out: Field[] = [];

  out.push({ label: kind === "appointment_cancelled" ? "Was" : "When", value: whenSentence(p) });

  if (kind === "appointment_rescheduled") {
    const prev = parseFloating(p.previousAt ?? null);
    if (prev) {
      out.push({
        label: "Previously",
        value: `${formatDayLabel(prev)} · ${formatRange(prev, p.durationMin || DEFAULT_DURATION_MIN)}`,
      });
    }
  }

  const where = addressLine(p);
  if (where) out.push({ label: "Where", value: where });

  const noun = (p.leadNoun || "lead").trim() || "lead";
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  out.push({ label: Noun, value: p.leadName || `Not recorded` });
  if (p.phone) out.push({ label: "Phone", value: formatPhone(p.phone) });
  if (p.email) out.push({ label: "Email", value: p.email });

  // The two money slots, under the ORG's labels. "Utility bill" / "Solar
  // payment" are one tenant's column names; the same typed columns are an
  // insurance org's premium or a recruiter's desired pay.
  const primaryMoney = p.moneyLabels?.primary?.trim() || "Monthly bill";
  const secondaryMoney = p.moneyLabels?.secondary?.trim();
  if (typeof p.utilityBill === "number" && p.utilityBill > 0) {
    out.push({
      label: primaryMoney,
      value: `${formatCurrency(p.utilityBill)}/mo${p.utilityProvider ? ` · ${p.utilityProvider}` : ""}`,
    });
  }
  if (secondaryMoney && typeof p.solarPayment === "number" && p.solarPayment > 0) {
    out.push({ label: secondaryMoney, value: `${formatCurrency(p.solarPayment)}/mo` });
  }
  // When a workspace tracks BOTH money slots, the combined figure is the point
  // of the call — say it plainly. Orgs that track one never see this row.
  if (
    secondaryMoney &&
    typeof p.utilityBill === "number" &&
    typeof p.solarPayment === "number" &&
    p.utilityBill > 0 &&
    p.solarPayment > 0
  ) {
    out.push({
      label: "Paying both",
      value: `${formatCurrency(p.utilityBill + p.solarPayment)}/mo combined`,
    });
  }

  out.push({
    label: "Booked by",
    value:
      p.source === "ai"
        ? `AI agent${ctx.repName ? ` · approved by ${ctx.repName}` : ""}`
        : ctx.repName || "Rep",
  });

  if (kind === "appointment_cancelled" && p.cancelReason?.trim()) {
    out.push({ label: "Reason", value: p.cancelReason.trim() });
  }
  if (p.notes?.trim()) out.push({ label: "Notes", value: p.notes.trim() });

  return out;
}

export function renderAppointmentEmail(ctx: RenderContext): RenderedEmail {
  const { kind, payload: p } = ctx;
  const lead = p.leadName || `an unnamed ${(p.leadNoun || "lead").trim() || "lead"}`;
  const accent = ACCENTS[kind];
  const rows = fields(ctx);
  const link = ctx.appUrl ? `${ctx.appUrl.replace(/\/$/, "")}/appointments` : "";

  const subject =
    kind === "appointment_set"
      ? `${SUBJECTS[kind]}: ${lead} — ${whenSentence(p)}`
      : `${SUBJECTS[kind]}: ${lead}`;

  const text = [
    HEADLINES[kind],
    ctx.orgName ? `(${ctx.orgName})` : "",
    "",
    ...rows.map((f) => `${f.label}: ${f.value}`),
    "",
    link ? `Open the calendar: ${link}` : "",
  ]
    .filter((l) => l !== "")
    .join("\n");

  const rowHtml = rows
    .map(
      (f) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;width:130px;">${esc(f.label)}</td>
          <td style="padding:10px 0 10px 16px;border-bottom:1px solid #e5e7eb;color:#111827;font-size:15px;font-weight:500;vertical-align:top;">${esc(f.value)}</td>
        </tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
      <tr>
        <td style="height:4px;background:${accent};line-height:4px;font-size:0;">&nbsp;</td>
      </tr>
      <tr>
        <td style="padding:28px 28px 8px;">
          <p style="margin:0 0 4px;color:${accent};font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">${esc(SUBJECTS[kind])}</p>
          <h1 style="margin:0;color:#111827;font-size:22px;line-height:1.3;font-weight:700;">${esc(HEADLINES[kind])}</h1>
          ${ctx.orgName ? `<p style="margin:6px 0 0;color:#6b7280;font-size:14px;">${esc(ctx.orgName)}</p>` : ""}
        </td>
      </tr>
      <tr>
        <td style="padding:12px 28px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">
            ${rowHtml}
          </table>
        </td>
      </tr>
      ${
        link
          ? `<tr>
        <td style="padding:20px 28px 28px;">
          <a href="${esc(link)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 20px;border-radius:10px;">Open the calendar</a>
        </td>
      </tr>`
          : `<tr><td style="padding:8px 28px 28px;"></td></tr>`
      }
    </table>
    <p style="max-width:560px;margin:16px auto 0;color:#9ca3af;font-size:12px;text-align:center;">
      Sent automatically when an appointment is set. Manage recipients in Admin → Notifications.
    </p>
  </body>
</html>`;

  return { subject, html, text };
}
