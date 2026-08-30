import "server-only";

import { isEmailConfigured } from "../email/resend";
import type { MetricId } from "../metrics/definitions";
import type { OrgFull } from "../org/membership";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { zonedDayStartMs } from "../dialer/schedule";
import { getCommandCenter, type CommandCenterData } from "./command-center";

// ─────────────────────────────────────────────────────────────────────────────
// King's pipeline — the one operating view (docs/phase_two.md §17).
//
// King is a person: the senior sales operator who proposed Phase 2 and wrote
// that document. So §17 is not an abstract requirement — it is him describing
// the screen he wants, and the five cards this file reports as unavailable are
// things HE asked for and is not getting. That is worth him seeing plainly,
// which is why they are surfaced rather than quietly omitted.
//
// His name appears in comments like this one and in the filename, never in the
// UI. §3 lists "Brock, King, DFW, solar" among the literals to keep out of the
// product — the tenant's own labels come from configuration.
//
// "King must not dig through ten screens. Build one role-aware operating view
// with accurate, real-time or clearly timestamped data."
//
// This module composes rather than re-queries. getCommandCenter already does
// the expensive org-wide reads — today's counts, the four attention queues, the
// pipeline-leak scan, the per-rep table, playbook instance counts — and §17 is
// explicit that the shared metrics service must be extended, not duplicated per
// widget. What is added here is only what King asks for and nothing else
// computes: the appointment-outcome counts, and the honest state of the three
// follow-up channels.
//
// THE RULE THIS FILE EXISTS TO ENFORCE. §17 says "do not hard-code example
// numbers". The harder version of that rule is: do not COMPUTE a number you
// cannot honestly compute. Five of King's ten cards depend on facts this
// deployment does not have — a confirmation channel, a published risk rule, a
// link from a no-show to its rebooking, a trusted fulfillment source. Each of
// those returns `value: null` with the reason attached, and the tile renders
// the reason. A fabricated 0 is worse than a hard-coded one, because it looks
// earned.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

/** One card in King's today strip. */
export interface StripCard {
  /** The glossary id — the tile's tooltip and this value share one definition. */
  id: MetricId;
  label: string;
  /** Null means "could not be computed", never zero. `unavailable` says why. */
  value: number | null;
  /** Required whenever `value` can be null. Rendered in place of the sub-label. */
  unavailable?: string;
  /** A floor rather than an exact count — the source scan hit its bound. */
  capped?: boolean;
  /** Extra context under the number when the value IS available. */
  sub?: string;
  /** Where clicking the card takes you. §17: every card must drill down. */
  href?: string;
}

/** One pipeline leak queue. §17: count, severity, oldest age, owner, action, SLA. */
export interface LeakQueue {
  key: string;
  label: string;
  /** Null = could not be counted. Zero = genuinely empty, and it collapses. */
  count: number | null;
  unavailable?: string;
  severity: "critical" | "high" | "normal";
  /** What King is supposed to DO about it — §17 requires an expected action. */
  action: string;
  href: string;
  /** ISO instant of the oldest item, when the source can tell us. */
  oldestAt?: string | null;
}

/** The health of one follow-up channel — what §17 calls automation health. */
export interface ChannelHealth {
  key: "playbooks" | "email" | "sms";
  label: string;
  /**
   * live    — running, and has done work
   * idle    — wired and permitted, but nothing has flowed through it
   * blocked — cannot run until something outside this screen changes
   * off     — deliberately switched off
   */
  state: "live" | "idle" | "blocked" | "off";
  /** One sentence of literal truth. Never a restatement of the label. */
  detail: string;
  /** The single next thing that would move it forward. */
  action?: string;
  /** Where to go and do that thing. */
  href?: string;
  /** Last time the job behind this channel actually executed. */
  lastTickAt?: string | null;
  /** Facts worth showing as small figures beside the state. */
  facts?: { label: string; value: string }[];
}

export interface KingPipelineData {
  /** When these numbers were read. §17 requires freshness on every card. */
  generatedAt: string;
  orgTimezone: string;
  strip: StripCard[];
  leaks: LeakQueue[];
  /** A sample of the leaking opportunities, for the drill-down table. */
  leakSample: CommandCenterData["leaks"]["sample"];
  reps: CommandCenterData["reps"];
  repsCapped: boolean;
  channels: ChannelHealth[];
  playbooks: CommandCenterData["playbooks"];
  instancesCapped: boolean;
  /** Set when the org-wide read failed outright — the page shows its own state. */
  degraded: boolean;
}

const NOT_COMPUTABLE = {
  confirmed:
    "No confirmation channel exists — nothing writes a confirmed state.",
  atRisk: "No risk rule has been published for this workspace.",
  recovered: "Nothing links a rebooking back to the no-show it replaced.",
  sold: "No trusted fulfillment source is wired.",
  installed: "No trusted fulfillment source is wired.",
  followup: "Work items carry no completion window to measure against.",
} as const;

/**
 * Everything King's view needs, in one call.
 *
 * Each section degrades on its own. A failure reading the channel heartbeats
 * must not blank the today strip, and vice versa — a leadership screen that
 * goes empty because one of six queries hiccuped is worse than one that says
 * which part it could not read.
 */
export async function getKingPipeline(input: {
  orgId: string;
  orgTz: string;
  org: OrgFull | null;
}): Promise<KingPipelineData> {
  const generatedAt = new Date().toISOString();
  const base: KingPipelineData = {
    generatedAt,
    orgTimezone: input.orgTz,
    strip: [],
    leaks: [],
    leakSample: [],
    reps: [],
    repsCapped: false,
    channels: [],
    playbooks: [],
    instancesCapped: false,
    degraded: false,
  };

  const [cc, appts, channels] = await Promise.all([
    getCommandCenter({ orgId: input.orgId, orgTz: input.orgTz }),
    readAppointmentOutcomes(input.orgId, input.orgTz),
    readChannelHealth(input.orgId, input.org),
  ]);

  base.channels = channels;
  if (!cc) {
    // The org-wide read is the spine of this page. Say so rather than
    // rendering a strip of zeros that look like a very quiet day.
    base.degraded = true;
    base.strip = strip(null, appts);
    return base;
  }

  base.strip = strip(cc, appts);
  base.leaks = leakQueues(cc);
  base.leakSample = cc.leaks.sample;
  base.reps = cc.reps;
  base.repsCapped = cc.scanCapped;
  base.playbooks = cc.playbooks;
  base.instancesCapped = cc.instancesCapped;
  return base;
}

/** King's today strip, in the order §17 lists them. */
function strip(
  cc: CommandCenterData | null,
  appts: { noShows: number | null },
): StripCard[] {
  const unread = "Couldn't read this count — it is not necessarily zero.";
  return [
    {
      id: "leads_worked",
      label: "Worked",
      value: cc?.today.leadsWorked ?? null,
      unavailable: unread,
      capped: cc?.scanCapped,
      sub: cc?.scanCapped ? "at least — very high volume today" : "unique, today",
      href: "/leads",
    },
    {
      id: "calls_today",
      label: "Dials",
      value: cc?.today.dials ?? null,
      unavailable: unread,
      sub: "attempts, today",
      href: "/recordings",
    },
    {
      id: "contacts_made",
      label: "Contacts",
      value: cc?.today.conversations ?? null,
      unavailable: unread,
      sub: "humans reached, today",
      href: "/recordings",
    },
    {
      id: "appointments_set",
      label: "Set",
      value: cc?.today.appointments ?? null,
      unavailable: unread,
      sub: "booked today",
      href: "/appointments",
    },
    {
      id: "appointments_confirmed",
      label: "Confirmed",
      value: null,
      unavailable: NOT_COMPUTABLE.confirmed,
    },
    {
      id: "appointments_at_risk",
      label: "At risk",
      value: null,
      unavailable: NOT_COMPUTABLE.atRisk,
    },
    {
      id: "no_shows",
      label: "No-shows",
      value: appts.noShows,
      unavailable: unread,
      sub: "scheduled for today",
      href: "/appointments",
    },
    {
      id: "no_show_recovered",
      label: "Recovered",
      value: null,
      unavailable: NOT_COMPUTABLE.recovered,
    },
    { id: "sales_closed", label: "Sales", value: null, unavailable: NOT_COMPUTABLE.sold },
    {
      id: "installs_completed",
      label: "Installs",
      value: null,
      unavailable: NOT_COMPUTABLE.installed,
    },
    {
      id: "hot_opportunities",
      label: "Hot",
      value: cc?.queues.hotSignals ?? null,
      unavailable: unread,
      sub: "open signals",
      href: "/dashboard",
    },
    {
      id: "speed_to_lead",
      label: "Speed to lead",
      value: cc?.today.speedToLeadMin ?? null,
      unavailable:
        cc && cc.today.speedToLeadMin === null
          ? "Not enough leads attempted today to report a median."
          : unread,
      sub: cc?.speedSampled ? "median · sampled" : "median minutes",
    },
    {
      id: "followup_completion",
      label: "Follow-up",
      value: null,
      unavailable: NOT_COMPUTABLE.followup,
    },
  ];
}

/**
 * §17's pipeline leaks: "count, severity, oldest age, owner/team, expected
 * action, SLA, and one-click operational drill-down".
 *
 * §17 names eleven queues. Five of them describe work this deployment does not
 * yet do (inbound reception, sold-stall, install care, no-show recovery,
 * automation dead-letter), and they are not listed as empty — an empty queue
 * reads as "nothing is leaking there", which is a claim. They are absent, and
 * the page says which ones and why.
 */
function leakQueues(cc: CommandCenterData): LeakQueue[] {
  return [
    {
      key: "untouched",
      label: "New, never touched",
      count: cc.queues.untouchedNew,
      severity: "critical",
      action: "Assign or dial — every hour here is speed-to-lead you cannot get back.",
      href: "/leads?f=untouched",
    },
    {
      key: "overdue_callbacks",
      label: "Callbacks overdue",
      count: cc.queues.overdueCallbacks,
      severity: "critical",
      action: "A promised time has passed. Call, or re-promise honestly.",
      href: "/callbacks",
    },
    {
      key: "unscheduled_callbacks",
      label: "Callbacks with no time",
      count: cc.queues.unscheduledCallbacks,
      severity: "high",
      action: "Give each one a due time, or it will never surface again.",
      href: "/callbacks",
    },
    {
      key: "hot",
      label: "Hot signals unworked",
      count: cc.queues.hotSignals,
      severity: "high",
      action: "The detector says these are ready. Work or dismiss them.",
      href: "/dashboard",
    },
    {
      key: "no_next_action",
      label: "No valid next action",
      count: cc.leaks.count,
      severity: "normal",
      action: "Open opportunities with nothing scheduled — they stall silently.",
      href: "/crm",
    },
  ];
}

/** No-show count for today, in the org's own calendar day. */
async function readAppointmentOutcomes(
  orgId: string,
  orgTz: string,
): Promise<{ noShows: number | null }> {
  if (!isAdminConfigured() || !orgId) return { noShows: null };
  try {
    const admin = createAdminClient();
    const startMs = zonedDayStartMs(Date.now(), orgTz);
    const { count, error } = await admin
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "no_show")
      .gte("scheduled_at", new Date(startMs).toISOString())
      .lt("scheduled_at", new Date(startMs + 86_400_000).toISOString());
    // `count ?? 0` would turn a failed read into "nobody missed an appointment".
    if (error) return { noShows: null };
    return { noShows: count ?? 0 };
  } catch {
    return { noShows: null };
  }
}

/**
 * The honest state of the three things that follow a lead up without a rep.
 *
 * This is the section King actually asked about, and the one where a dashboard
 * is most tempted to lie. Each channel reports what is literally true right
 * now, read from the same heartbeats and tables the jobs themselves write.
 */
async function readChannelHealth(
  orgId: string,
  org: OrgFull | null,
): Promise<ChannelHealth[]> {
  const out: ChannelHealth[] = [];
  if (!isAdminConfigured()) {
    // Not "no channels" — "we cannot see the channels". Without the service
    // role these heartbeats are unreadable, and silently dropping the section
    // would tell King the automation question does not apply to them. It does;
    // we just cannot answer it.
    return (
      [
        ["playbooks", "Playbook automation"],
        ["email", "Appointment email"],
        ["sms", "SMS follow-up"],
      ] as const
    ).map(([key, label]) => ({
      key,
      label,
      state: "blocked" as const,
      detail:
        "Can't be read from here — this deployment has no service-role key, so the job heartbeats are invisible.",
      action: "Check the deployment's Supabase credentials.",
      href: "/admin",
    }));
  }

  let settings: Row | null = null;
  let messagesEver: number | null = null;
  let emailSkipped: number | null = null;
  let templatesPublished: number | null = null;
  try {
    const admin = createAdminClient();
    const [s, m, e, t] = await Promise.all([
      admin
        .from("app_settings")
        .select(
          "orchestration_paused, orchestration_last_tick_at, messaging_paused, messaging_last_tick_at",
        )
        .eq("id", "global")
        .maybeSingle(),
      admin.from("messages").select("id", { count: "exact", head: true }).eq("org_id", orgId),
      admin
        .from("notification_outbox")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "skipped"),
      admin
        .from("message_templates")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "published"),
    ]);
    settings = (s.data ?? null) as Row | null;
    messagesEver = m.error ? null : (m.count ?? 0);
    emailSkipped = e.error ? null : (e.count ?? 0);
    templatesPublished = t.error ? null : (t.count ?? 0);
  } catch {
    /* fall through — each channel below reports what it could not read */
  }

  // ── Playbooks ─────────────────────────────────────────────────────────────
  const orchTick = (settings?.orchestration_last_tick_at as string | null) ?? null;
  const orchPaused = settings?.orchestration_paused === true;
  const orchFresh = orchTick != null && Date.now() - Date.parse(orchTick) < 10 * 60_000;
  out.push({
    key: "playbooks",
    label: "Playbook automation",
    state: orchPaused ? "off" : orchFresh ? "live" : orchTick ? "blocked" : "blocked",
    detail: orchPaused
      ? "Paused platform-wide by the kill switch. Nothing is being enforced."
      : orchFresh
        ? "Running. The engine ticked within the last ten minutes and is enforcing published playbooks."
        : orchTick
          ? "The engine has stopped — it last ticked more than ten minutes ago, so scheduled steps are not firing."
          : "The engine has never executed in this deployment. Published playbooks are not being enforced.",
    action: orchPaused
      ? "Clear the kill switch in the superadmin console."
      : orchFresh
        ? undefined
        : "Check the orchestrate cron job.",
    href: "/admin",
    lastTickAt: orchTick,
  });

  // ── Email ─────────────────────────────────────────────────────────────────
  const emailConfigured = isEmailConfigured();
  const recipients = Array.isArray(
    (org?.settings as { notifications?: { appointmentEmails?: unknown[] } } | undefined)
      ?.notifications?.appointmentEmails,
  )
    ? (
        (org?.settings as { notifications?: { appointmentEmails?: unknown[] } })
          .notifications as { appointmentEmails: unknown[] }
      ).appointmentEmails.length
    : 0;
  out.push({
    key: "email",
    label: "Appointment email",
    state: !emailConfigured ? "blocked" : recipients === 0 ? "blocked" : "live",
    detail: !emailConfigured
      ? "No email provider is configured, so nothing can be sent."
      : recipients === 0
        ? `Configured and working, but this workspace has no recipient address — so every appointment email is created and then dropped.${
            emailSkipped ? ` ${emailSkipped} have been dropped so far.` : ""
          }`
        : `Sending to ${recipients} recipient${recipients === 1 ? "" : "s"} when an appointment is booked, moved or cancelled.`,
    // The scope limit is the point: this is the ONLY email the product sends,
    // and it goes to staff. Nobody should read this card as customer email.
    action:
      emailConfigured && recipients === 0
        ? "Add an address under Admin → Notifications."
        : undefined,
    href: "/admin",
    facts: [
      { label: "Audience", value: "Your own staff — never the customer" },
      {
        label: "Dropped for no recipient",
        value: emailSkipped === null ? "unknown" : String(emailSkipped),
      },
    ],
  });

  // ── SMS ───────────────────────────────────────────────────────────────────
  const msgTick = (settings?.messaging_last_tick_at as string | null) ?? null;
  const msgPaused = settings?.messaging_paused === true;
  const smsEnabled =
    (org?.settings as { messaging?: { enabled?: boolean } } | undefined)?.messaging?.enabled ===
    true;
  out.push({
    key: "sms",
    label: "SMS follow-up",
    state: msgPaused ? "off" : msgTick == null ? "blocked" : smsEnabled ? "live" : "idle",
    detail: msgPaused
      ? "Paused platform-wide by the kill switch."
      : msgTick == null
        ? "The send job has never run in this deployment, so an approved message would not go out."
        : !smsEnabled
          ? "The send job is running, but this workspace has messaging switched off."
          : "Running, and this workspace has messaging enabled.",
    action:
      msgTick == null ? "Schedule the messages cron before approving anything to send." : undefined,
    href: "/admin",
    lastTickAt: msgTick,
    facts: [
      { label: "Sent ever", value: messagesEver === null ? "unknown" : String(messagesEver) },
      {
        label: "Published templates",
        value: templatesPublished === null ? "unknown" : String(templatesPublished),
      },
    ],
  });

  return out;
}
