import "server-only";

import { getPublicBaseUrl, getRestClient } from "../twilio";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import type { OrgFull } from "../org/membership";
import { isMessagingConfigured, isMessagingSimulated } from "./config";
import { isSupervisorRole } from "../permissions";

// ─────────────────────────────────────────────────────────────────────────────
// Is this workspace actually able to send a message — and to hear a reply?
//
// This exists because of a specific, expensive failure: every dialing number's
// Messaging webhook points at ElevenLabs, which 404s inbound SMS, and the proof
// is in the data — `dnc_numbers` contains ZERO rows sourced from a text message
// across the platform's entire history. Nobody noticed for months, because a
// webhook pointing at the wrong place looks exactly like nobody texting you.
//
// So this is not a checklist of things someone ticks. Every line is CHECKED,
// against Twilio, at the moment it is read. A checkbox that says "webhook
// configured" is worth nothing; a line that says "this number's messages go to
// api.elevenlabs.io" is worth the whole feature.
//
// It runs on the server, where the credentials live. The credentials are marked
// sensitive in the deployment and cannot be pulled to a developer machine — so
// asking the running application is the ONLY way to find this out, which is
// exactly why it belongs in the product rather than in a runbook.
// ─────────────────────────────────────────────────────────────────────────────

export interface NumberReadiness {
  phoneNumber: string;
  friendlyName: string;
  /** Twilio says this number can send and receive SMS at all. */
  smsCapable: boolean;
  /** Where its inbound messages currently go. Empty means nowhere. */
  smsUrl: string;
  /** True when that URL reaches this application's inbound route. */
  pointsHere: boolean;
  /**
   * Set when the URL is the right ROUTE but on a host this deployment does not
   * answer on — most likely a different environment of the same app. Worth
   * saying out loud rather than filing under "points somewhere else", because
   * the fix is completely different.
   */
  otherEnvironment?: boolean;
  /** Set when the number is in the org's caller-ID pool but not on the account. */
  notOnAccount?: boolean;
}

export type CheckState = "ok" | "warn" | "fail" | "unknown";

export interface ReadinessCheck {
  id: string;
  label: string;
  state: CheckState;
  /** What is true right now, in the operator's words. Never a restatement. */
  detail: string;
  /** What to do about it, when there is something to do. */
  action?: string;
}

export interface MessagingReadiness {
  checks: ReadinessCheck[];
  numbers: NumberReadiness[];
  /** True only when nothing is failing. Warnings do not block. */
  ready: boolean;
  /** Set when Twilio could not be reached, so number checks are unknown. */
  providerError: string | null;
}

const INBOUND_PATH = "/api/twilio/sms";

/**
 * Every host this deployment actually answers on.
 *
 * There is more than one, and that is the point. Callbacks are PINNED to the
 * Vercel origin on purpose (see getPublicBaseUrl — machine-to-machine callbacks
 * gain nothing from the CDN and can be eaten by a WAF), but the same app also
 * serves the Cloudflare-fronted custom domain, and a webhook pointed at either
 * works: verifyTwilioSignature reconstructs the URL from several candidate
 * origins and accepts if ANY validates.
 *
 * So comparing against one canonical origin would call a perfectly good
 * custom-domain webhook "pointing somewhere else" and offer to repoint it —
 * a false alarm in the one panel whose entire value is being trusted about
 * this. Match on host + path instead.
 */
export function knownHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const candidate of [
    getPublicBaseUrl(),
    process.env.NEXT_PUBLIC_APP_URL ?? "",
    process.env.TWILIO_CALLBACK_BASE_URL ?? "",
  ]) {
    if (!candidate) continue;
    try {
      hosts.add(new URL(candidate).host.toLowerCase());
    } catch {
      /* a malformed env value is not a host */
    }
  }
  return hosts;
}

export type WebhookVerdict = "here" | "other_environment" | "elsewhere" | "unset";

/** Exported so the classification itself is testable — it is the whole fix. */
export function classifyWebhook(smsUrl: string, hosts: Set<string>): WebhookVerdict {
  if (!smsUrl.trim()) return "unset";
  let url: URL;
  try {
    url = new URL(smsUrl);
  } catch {
    return "elsewhere";
  }
  // Trailing slashes and query strings are Twilio-console noise, not meaning.
  const path = url.pathname.replace(/\/+$/, "");
  if (path !== INBOUND_PATH) return "elsewhere";
  return hosts.has(url.host.toLowerCase()) ? "here" : "other_environment";
}

export async function getMessagingReadiness(
  org: OrgFull | null,
): Promise<MessagingReadiness> {
  const checks: ReadinessCheck[] = [];
  let numbers: NumberReadiness[] = [];
  let providerError: string | null = null;

  // ── 1. Credentials ────────────────────────────────────────────────────────
  const configured = isMessagingConfigured();
  checks.push({
    id: "credentials",
    label: "Messaging credentials",
    state: configured ? "ok" : "fail",
    detail: configured
      ? "The deployment has Twilio credentials, so it can send."
      : "TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing, so nothing can be sent.",
    action: configured ? undefined : "Set both in the deployment's environment.",
  });

  if (isMessagingSimulated()) {
    checks.push({
      id: "simulation",
      label: "Simulation mode",
      state: "warn",
      // A warning, not a failure: this is a legitimate way to run. But it must
      // be impossible to believe messages are going out when they are not.
      detail:
        "MESSAGING_SIMULATION is on, so nothing reaches a real phone. Everything else here still applies.",
      action: "Unset MESSAGING_SIMULATION when you want real sends.",
    });
  }
  if ((process.env.MESSAGING_ALLOWLIST ?? "").trim()) {
    checks.push({
      id: "allowlist",
      label: "Recipient allow-list",
      state: "warn",
      detail:
        "MESSAGING_ALLOWLIST is set, so only the numbers on it can be reached. Everything else is refused before sending.",
      action: "Unset it to message customers.",
    });
  }

  // ── 2. The workspace's own switch ─────────────────────────────────────────
  const orgOn = org?.settings.messaging.enabled === true;
  checks.push({
    id: "org_enabled",
    label: "Messaging for this workspace",
    state: orgOn ? "ok" : "fail",
    detail: orgOn
      ? "Switched on."
      : "Switched off, so no message will be proposed or sent for this workspace.",
    action: orgOn ? undefined : "Turn it on in Admin → Messaging.",
  });

  // ── 3. Quiet hours ────────────────────────────────────────────────────────
  const quiet = org?.settings.messaging.quietHours;
  const sane =
    quiet != null &&
    Number.isFinite(quiet.startHour) &&
    Number.isFinite(quiet.endHour) &&
    quiet.startHour !== quiet.endHour;
  checks.push({
    id: "quiet_hours",
    label: "Messaging hours",
    state: sane ? "ok" : "fail",
    detail: sane
      ? `Messages only go out between ${fmtHour(quiet!.startHour)} and ${fmtHour(quiet!.endHour)} in the recipient's own timezone.`
      : "No usable window is set, so every message would be held indefinitely.",
    action: sane ? undefined : "Set a start and end hour in Admin → Messaging.",
  });

  // ── 4. The daily ceiling ──────────────────────────────────────────────────
  const cap = org?.settings.messaging.dailyOrgCap ?? 0;
  checks.push({
    id: "daily_cap",
    label: "Daily send limit",
    state: cap > 0 ? "ok" : "warn",
    detail:
      cap > 0
        ? `At most ${cap} messages a day across the whole workspace.`
        : "No daily limit, so a misconfigured playbook has nothing stopping it.",
    action: cap > 0 ? undefined : "Set a daily limit in Admin → Messaging.",
  });

  // ── 5. Somebody has to be able to approve ─────────────────────────────────
  // Null means the member read failed — which is NOT the same as nobody having
  // the permission, and the difference matters because "nobody can approve" is
  // an actionable claim that sends an operator to fix a non-problem.
  const approvers = await countApprovers(org?.id ?? null);
  checks.push({
    id: "approvers",
    label: "People who can approve",
    state:
      approvers === null ? "warn" : approvers >= 2 ? "ok" : approvers === 1 ? "warn" : "fail",
    detail:
      approvers === null
        ? "Couldn't read this workspace's members, so we can't tell who is able to approve."
        : approvers === 0
          ? "Nobody in this workspace can approve a message, so every proposal would sit forever."
          : approvers === 1
            ? "Only one person can approve messages. Nothing goes out while they're away."
            : `${approvers} people can approve messages.`,
    action:
      approvers === null || approvers >= 2
        ? undefined
        : "Grant the approval permission in Admin → Members.",
  });

  // ── 6. Something to send ──────────────────────────────────────────────────
  // Every readout on this page is something an operator will act on. "No
  // published templates" sends them to write one they may already have.
  const templates = await countPublishedTemplates(org?.id ?? null);
  checks.push({
    id: "templates",
    label: "Published templates",
    state: templates === null ? "warn" : templates > 0 ? "ok" : "warn",
    detail:
      templates === null
        ? "Couldn't count this workspace's templates, so we can't tell whether a playbook has wording to propose."
        : templates > 0
          ? `${templates} published.`
          : "No published templates, so a playbook's send_message step has no wording to propose.",
    action:
      templates === null
        ? "Try again in a moment."
        : templates > 0
          ? undefined
          : "Publish a template before enabling a messaging playbook.",
  });

  // ── 7. The drain ──────────────────────────────────────────────────────────
  const tick = await lastDrainTick();
  const fresh = tick != null && Date.now() - Date.parse(tick) < 10 * 60_000;
  checks.push({
    id: "drain",
    label: "The send job",
    state: fresh ? "ok" : "fail",
    detail: fresh
      ? `Last ran ${describeAgo(tick!)}.`
      : tick
        ? `Last ran ${describeAgo(tick)} — it has stopped. Approved messages are queuing up unsent.`
        : "It has never run, so approving a message would not send it.",
    action: fresh
      ? undefined
      : "Schedule the messages job — see supabase/cron.sql.",
  });

  // ── 8. The numbers themselves. The check that found the real problem. ─────
  const expected = getPublicBaseUrl();
  const hosts = knownHosts();
  const pool = new Set(
    [
      ...(org?.settings.dialing.callerIds ?? []),
      org?.settings.dialing.callerId ?? "",
    ]
      .map((n) => digits(n))
      .filter(Boolean),
  );

  if (!configured) {
    checks.push({
      id: "webhooks",
      label: "Inbound message webhooks",
      state: "unknown",
      detail: "Cannot check without credentials.",
    });
  } else {
    try {
      const client = await getRestClient();
      if (!client) throw new Error("No Twilio client.");
      const owned = await client.incomingPhoneNumbers.list({ limit: 200 });
      const byDigits = new Map(owned.map((n) => [digits(String(n.phoneNumber)), n]));

      numbers = [...pool].map((d) => {
        const n = byDigits.get(d);
        if (!n) {
          return {
            phoneNumber: d,
            friendlyName: "",
            smsCapable: false,
            smsUrl: "",
            pointsHere: false,
            notOnAccount: true,
          };
        }
        const smsUrl = String(n.smsUrl ?? "");
        const verdict = classifyWebhook(smsUrl, hosts);
        return {
          phoneNumber: String(n.phoneNumber),
          friendlyName: String(n.friendlyName ?? ""),
          smsCapable: Boolean((n.capabilities as { sms?: boolean } | undefined)?.sms),
          smsUrl,
          pointsHere: verdict === "here",
          otherEnvironment: verdict === "other_environment",
        };
      });

      const capable = numbers.filter((n) => n.smsCapable);
      const wired = capable.filter((n) => n.pointsHere);
      checks.push({
        id: "sms_capable",
        label: "Numbers that can text",
        state: capable.length > 0 ? "ok" : "fail",
        detail:
          capable.length > 0
            ? `${capable.length} of ${numbers.length} of this workspace's numbers support SMS.`
            : "None of this workspace's numbers support SMS, so nothing can be sent from them.",
        action:
          capable.length > 0 ? undefined : "Use an SMS-capable number, or enable SMS on one.",
      });
      // Split, because the two have completely different fixes: one is a
      // webhook pointed at another product, the other is a webhook pointed at
      // a different environment of THIS one.
      const strays = capable.filter((n) => !n.pointsHere && !n.otherEnvironment);
      const otherEnv = capable.filter((n) => n.otherEnvironment);
      checks.push({
        id: "webhooks",
        label: "Inbound message webhooks",
        state: wired.length === capable.length && capable.length > 0 ? "ok" : "fail",
        detail:
          capable.length === 0
            ? "No SMS-capable numbers to check."
            : wired.length === capable.length
              ? "Every SMS-capable number sends its inbound messages here."
              : [
                  strays.length > 0 &&
                    `${strays.length} of ${capable.length} send their inbound messages somewhere else entirely. Replies — INCLUDING STOP — are being dropped.`,
                  otherEnv.length > 0 &&
                    `${otherEnv.length} point at this app's inbound route on a different host, so replies reach another environment rather than this one.`,
                ]
                  .filter(Boolean)
                  .join(" "),
        action:
          wired.length === capable.length
            ? undefined
            : `Point each number's Messaging webhook at ${expected ?? "this app"}${INBOUND_PATH} (POST).`,
      });
    } catch (e: unknown) {
      providerError = (e as { message?: string })?.message ?? "Twilio could not be reached.";
      checks.push({
        id: "webhooks",
        label: "Inbound message webhooks",
        state: "unknown",
        // Unknown, never "ok". A check that cannot run has not passed.
        detail: `Could not ask Twilio: ${providerError}`,
      });
    }
  }

  return {
    checks,
    numbers,
    // `unknown` blocks too. A check that could not run has not passed, and
    // "Ready to send" while the webhook check never reached Twilio is exactly
    // the reassurance this panel exists to refuse.
    ready: !checks.some((c) => c.state === "fail" || c.state === "unknown"),
    providerError,
  };
}

function digits(v: string): string {
  const d = String(v ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : "";
}

function fmtHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  const period = hh < 12 ? "am" : "pm";
  return `${hh % 12 === 0 ? 12 : hh % 12}${period}`;
}

function describeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "at an unknown time";
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return "moments ago";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

async function countApprovers(orgId: string | null): Promise<number | null> {
  if (!orgId || !isAdminConfigured()) return 0;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("organization_members")
      .select("role, permissions")
      .eq("org_id", orgId)
      .eq("status", "active");
    // Null, not 0. Returning a count of zero told an operator their workspace
    // has NOBODY who can approve messages — a specific, actionable falsehood
    // that sends them off to fix a problem they do not have.
    if (error) return null;
    // Mirrors ROLE_PERMISSIONS without importing it: owner/admin/manager hold
    // messaging.approve by default, and a per-member override wins either way.
    return ((data ?? []) as Record<string, unknown>[]).filter((m) => {
      const overrides = (m.permissions ?? {}) as Record<string, boolean>;
      if ("messaging.approve" in overrides) return overrides["messaging.approve"];
      return isSupervisorRole(m.role);
    }).length;
  } catch {
    return 0;
  }
}

/** Null when the count could not be taken — which is not "none published". */
async function countPublishedTemplates(orgId: string | null): Promise<number | null> {
  if (!orgId || !isAdminConfigured()) return 0;
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("message_templates")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "published");
    if (error) return null;
    return count ?? null;
  } catch {
    return null;
  }
}

async function lastDrainTick(): Promise<string | null> {
  if (!isAdminConfigured()) return null;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("app_settings")
      .select("messaging_last_tick_at")
      .eq("id", "global")
      .maybeSingle();
    return data?.messaging_last_tick_at ? String(data.messaging_last_tick_at) : null;
  } catch {
    return null;
  }
}
