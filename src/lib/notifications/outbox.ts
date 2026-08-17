import "server-only";

import {
  type AppointmentEmailKind,
  type AppointmentEmailPayload,
  renderAppointmentEmail,
} from "../email/templates/appointment";
import { emailConfigProblem, isEmailConfigured, sendEmail } from "../email/resend";
import { mergeSettings } from "../org/settings";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { MAX_ATTEMPTS, nextAttemptDelayMs } from "./backoff";

export { BACKOFF_MIN, MAX_ATTEMPTS, nextAttemptDelayMs } from "./backoff";

// ─────────────────────────────────────────────────────────────────────────────
// The notification outbox drain — the half of "email Brock when an appointment
// is set" that makes it a promise rather than a hope.
//
// The enqueue is a Postgres trigger (see PART 13 in supabase/schema.sql): atomic
// with the booking, so the email can never be lost to a lambda dying between two
// writes. This is the other half: take what's due, send it, and — crucially —
// record what happened. A send that fails is retried on a backoff; a send that
// keeps failing goes terminal `failed`, which lights up the notifications bell
// and a banner on the calendar. Nothing about a failed notification is silent.
//
// Runs from the per-minute cron tick (both /api/cron/reconcile-ai, which already
// exists and needs no new schedule, and the standalone /api/cron/notifications).
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

export interface DrainResult {
  sent: number;
  failed: number;
  skipped: number;
  retrying: number;
  remaining: boolean;
}

interface OrgContext {
  name: string;
  emails: string[];
  enabled: boolean;
  ccBookingRep: boolean;
  fromName: string;
}

/** Deployment-wide fallback for orgs that never opened Admin → Notifications. */
function envRecipients(): string[] {
  return (process.env.APPOINTMENT_NOTIFY_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim())
    .filter(Boolean);
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "";
}

/** Org settings → who to email. Cached per drain so 25 rows don't do 25 lookups. */
async function loadOrg(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string | null,
  cache: Map<string, OrgContext>,
): Promise<OrgContext> {
  const key = orgId ?? "-";
  const hit = cache.get(key);
  if (hit) return hit;

  let ctx: OrgContext = {
    name: "",
    emails: envRecipients(),
    enabled: true,
    ccBookingRep: false,
    fromName: "",
  };

  if (orgId) {
    try {
      const { data } = await admin
        .from("organizations")
        .select("name,settings")
        .eq("id", orgId)
        .maybeSingle();
      if (data) {
        const settings = mergeSettings((data as Row).settings);
        const n = settings.notifications;
        ctx = {
          name: s((data as Row).name),
          // The org's own list wins. The env var is only a fallback for a
          // workspace that has never configured one.
          emails: n.appointmentEmails.length ? n.appointmentEmails : envRecipients(),
          enabled: n.appointmentEmail !== false,
          ccBookingRep: Boolean(n.ccBookingRep),
          fromName: n.fromName || "",
        };
      }
    } catch {
      /* fall through to the env fallback */
    }
  }

  cache.set(key, ctx);
  return ctx;
}

/** owner_id → display name, so the email says who booked it. */
async function memberName(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string | null,
  userId: string,
  cache: Map<string, string>,
): Promise<string> {
  if (!userId) return "";
  const hit = cache.get(userId);
  if (hit !== undefined) return hit;
  let name = "";
  try {
    const base = admin.from("organization_members").select("name,email").eq("user_id", userId);
    const { data } = await (orgId ? base.eq("org_id", orgId) : base).maybeSingle();
    name = s((data as Row | null)?.name) || s((data as Row | null)?.email);
  } catch {
    /* the email reads fine without a rep name */
  }
  cache.set(userId, name);
  return name;
}

/** The rep's own address, for the optional CC. */
async function memberEmail(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<string> {
  if (!userId) return "";
  try {
    const { data } = await admin
      .from("organization_members")
      .select("email")
      .eq("user_id", userId)
      .maybeSingle();
    return s((data as Row | null)?.email);
  } catch {
    return "";
  }
}

async function markSent(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  attempts: number,
  providerId?: string,
) {
  await admin
    .from("notification_outbox")
    .update({
      status: "sent",
      attempts,
      sent_at: new Date().toISOString(),
      provider_id: providerId ?? null,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

/**
 * A notification nobody asked for is not a failure. An org with the master switch
 * off, or with no recipients anywhere, gets a terminal `skipped` — which never
 * raises an alert. Reserving `failed` for things that are ACTUALLY broken is what
 * keeps the alert meaningful enough to act on.
 */
async function markSkipped(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  reason: string,
) {
  await admin
    .from("notification_outbox")
    .update({
      status: "skipped",
      last_error: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

async function markAttemptFailed(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  attempts: number,
  error: string,
): Promise<"retrying" | "failed"> {
  const delay = nextAttemptDelayMs(attempts);
  if (delay == null) {
    await admin
      .from("notification_outbox")
      .update({
        status: "failed",
        attempts,
        last_error: error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    // Terminal. The bell + the calendar banner pick this up from here; this log
    // is for whoever is already tailing the function.
    console.error(
      `[outbox] notification ${id} FAILED after ${attempts} attempts — alerting in-app. Last error: ${error}`,
    );
    return "failed";
  }
  await admin
    .from("notification_outbox")
    .update({
      status: "pending",
      attempts,
      last_error: error,
      next_attempt_at: new Date(Date.now() + delay).toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return "retrying";
}

/**
 * Send everything that's due. Bounded by a time budget so it can share a
 * serverless invocation with the AI reconciler without either of them being
 * killed mid-flight — `remaining` tells the next tick there's more to do.
 */
export async function drainOutbox(
  opts: { budgetMs?: number; limit?: number } = {},
): Promise<DrainResult> {
  const out: DrainResult = { sent: 0, failed: 0, skipped: 0, retrying: 0, remaining: false };
  if (!isAdminConfigured()) return out;

  const budgetMs = opts.budgetMs ?? 8_000;
  const limit = opts.limit ?? 25;
  const deadline = Date.now() + budgetMs;
  const admin = createAdminClient();

  let batch: Row[] = [];
  try {
    // ATOMICALLY claim the batch (flip due rows to 'sending' under FOR UPDATE
    // SKIP LOCKED). The old plain SELECT let the two per-minute crons pick the
    // same rows and send the same appointment email twice; now each caller gets
    // a disjoint set. The RPC also reclaims rows stuck in 'sending' (a crashed
    // drain), so nothing is stranded.
    const { data, error } = await admin.rpc("app_claim_notifications", { p_limit: limit });
    if (error) {
      console.error("[outbox] could not claim the queue:", error.message);
      return out;
    }
    batch = (data ?? []) as Row[];
  } catch (e) {
    console.error("[outbox] queue claim threw:", e instanceof Error ? e.message : e);
    return out;
  }

  // A full batch almost certainly means there's more waiting for the next tick.
  out.remaining = batch.length >= limit;

  const orgCache = new Map<string, OrgContext>();
  const nameCache = new Map<string, string>();

  for (const row of batch) {
    if (Date.now() > deadline) {
      out.remaining = true;
      break;
    }

    const id = s(row.id);
    const orgId = row.org_id ? s(row.org_id) : null;
    const kind = s(row.kind) as AppointmentEmailKind;
    const payload = (row.payload ?? {}) as AppointmentEmailPayload & { ownerId?: string };
    const attempts = Number(row.attempts ?? 0) + 1;

    const org = await loadOrg(admin, orgId, orgCache);

    if (!org.enabled) {
      await markSkipped(admin, id, "Appointment email is switched off for this workspace.");
      out.skipped++;
      continue;
    }

    const to = [...org.emails];
    if (org.ccBookingRep && payload.ownerId) {
      const rep = await memberEmail(admin, payload.ownerId);
      if (rep && !to.includes(rep)) to.push(rep);
    }

    if (!to.length) {
      await markSkipped(
        admin,
        id,
        "No recipients configured (Admin → Notifications, or APPOINTMENT_NOTIFY_EMAILS).",
      );
      out.skipped++;
      continue;
    }

    // Recipients ARE configured but the provider isn't — somebody expects this
    // email and it cannot be sent. That's a real misconfiguration, so it retries
    // and then alerts, rather than being quietly skipped.
    if (!isEmailConfigured()) {
      const result = await markAttemptFailed(
        admin,
        id,
        attempts,
        emailConfigProblem() ?? "Email is not configured.",
      );
      out[result === "failed" ? "failed" : "retrying"]++;
      continue;
    }

    const repName = payload.ownerId
      ? await memberName(admin, orgId, payload.ownerId, nameCache)
      : "";

    const email = renderAppointmentEmail({
      kind,
      payload,
      repName,
      orgName: org.name,
      appUrl: appUrl(),
    });

    const sent = await sendEmail({
      to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      fromName: org.fromName || org.name || undefined,
      // The outbox row id — if a send ever repeats (a crash after sending but
      // before markSent), Resend dedupes on this key.
      idempotencyKey: id,
    });

    if (sent.ok) {
      await markSent(admin, id, attempts, sent.id);
      out.sent++;
    } else {
      const result = await markAttemptFailed(admin, id, attempts, sent.error ?? "Send failed.");
      out[result === "failed" ? "failed" : "retrying"]++;
    }
  }

  return out;
}

/**
 * Put a terminally-failed notification back in the queue — the "Retry now" button
 * behind the alert. Resets the attempt counter, so the operator who just fixed
 * the API key gets the full backoff ladder again rather than one shot.
 */
export async function retryNotification(id: string, orgId: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!isAdminConfigured()) return { ok: false, error: "Not configured." };
  try {
    const admin = createAdminClient();
    const base = admin
      .from("notification_outbox")
      .update({
        status: "pending",
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("status", "failed");
    // Scope to the caller's org — an id from another workspace matches nothing.
    const q = id === "all" ? base : base.eq("id", id);
    const { error } = await (orgId ? q.eq("org_id", orgId) : q);
    return error ? { ok: false, error: error.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Retry failed." };
  }
}

export interface FailedNotification {
  id: string;
  kind: string;
  leadName: string;
  lastError: string;
  attempts: number;
  createdAt: string;
  appointmentId: string | null;
}

/** Every notification this org has given up on — the alert surfaces read this. */
export async function listFailedNotifications(orgId: string | null): Promise<FailedNotification[]> {
  if (!isAdminConfigured() || !orgId) return [];
  try {
    const { data } = await createAdminClient()
      .from("notification_outbox")
      .select("id,kind,payload,last_error,attempts,created_at,appointment_id")
      .eq("org_id", orgId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(20);
    return ((data ?? []) as Row[]).map((r) => ({
      id: s(r.id),
      kind: s(r.kind),
      leadName: s((r.payload as AppointmentEmailPayload | null)?.leadName) || "Homeowner",
      lastError: s(r.last_error),
      attempts: Number(r.attempts ?? 0),
      createdAt: s(r.created_at),
      appointmentId: r.appointment_id ? s(r.appointment_id) : null,
    }));
  } catch {
    return [];
  }
}
