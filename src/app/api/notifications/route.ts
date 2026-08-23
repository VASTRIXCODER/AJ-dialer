import { NextResponse } from "next/server";
import { listFailedNotifications } from "@/lib/notifications/outbox";
import { getViewer } from "@/lib/org/membership";
import { orgVocabulary } from "@/lib/org/vocabulary";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));

const OUTCOME_LABEL: Record<string, string> = {
  appointment_booked: "Appointment booked",
  callback_scheduled: "Callback scheduled",
  qualified: "Qualified",
  not_interested: "Not interested",
  no_answer: "No answer",
  voicemail: "Voicemail",
  wrong_number: "Wrong number",
  do_not_call: "Do not call",
};

export interface Notification {
  id: string;
  type: "appointment" | "callback" | "call" | "alert";
  title: string;
  body: string;
  at: string;
  href: string;
}

const KIND_LABEL: Record<string, string> = {
  appointment_set: "Appointment email",
  appointment_rescheduled: "Reschedule email",
  appointment_cancelled: "Cancellation email",
};

/**
 * Account-scoped notifications derived from real activity — booked appointments,
 * callbacks to make, and completed AI calls — newest first. No placeholder data:
 * empty until the account actually does something.
 */
export async function GET() {
  if (!isSupabaseConfigured()) return NextResponse.json({ notifications: [] });
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ notifications: [] });

    // Own-scoped, AND within the CURRENT org — an appointment/callback/call this
    // account owns from a past org must not surface as a notification in a
    // freshly joined/created one.
    const { data: prof } = await supabase
      .from("profiles")
      .select("org_id")
      .eq("id", user.id)
      .maybeSingle();
    const orgId = prof?.org_id ? String(prof.org_id) : null;

    const [appts, callbacks, calls] = await Promise.all([
      (() => {
        let q = supabase
          .from("appointments")
          .select("id,lead_name,scheduled_label,created_at")
          .eq("owner_id", user.id);
        if (orgId) q = q.eq("org_id", orgId);
        return q.order("created_at", { ascending: false }).limit(8);
      })(),
      (() => {
        let q = supabase
          .from("callbacks")
          .select("id,lead_name,reason,created_at,status")
          .eq("owner_id", user.id)
          .neq("status", "completed");
        if (orgId) q = q.eq("org_id", orgId);
        return q.order("created_at", { ascending: false }).limit(8);
      })(),
      (() => {
        let q = supabase
          .from("call_records")
          .select("id,lead_name,outcome,started_at,channel")
          .eq("owner_id", user.id)
          .eq("channel", "ai");
        if (orgId) q = q.eq("org_id", orgId);
        return q.order("started_at", { ascending: false }).limit(8);
      })(),
    ]);

    // A nameless row is a data gap, not a homeowner — and "homeowner" is one
    // vertical's word regardless. Use the workspace's own noun.
    const viewer = await getViewer();
    const leadNoun = `Unknown ${orgVocabulary(viewer.org).leadNoun}`;

    const notifications: Notification[] = [];

    for (const a of (appts.data ?? []) as Row[]) {
      notifications.push({
        id: `a-${s(a.id)}`,
        type: "appointment",
        title: "Appointment booked",
        body: `${s(a.lead_name) || leadNoun}${a.scheduled_label ? ` — ${s(a.scheduled_label)}` : ""}`,
        at: s(a.created_at),
        href: "/appointments",
      });
    }
    for (const c of (callbacks.data ?? []) as Row[]) {
      notifications.push({
        id: `c-${s(c.id)}`,
        type: "callback",
        title: "Callback to make",
        body: `${s(c.lead_name) || leadNoun}${c.reason ? ` — ${s(c.reason)}` : ""}`,
        at: s(c.created_at),
        href: "/callbacks",
      });
    }
    for (const r of (calls.data ?? []) as Row[]) {
      notifications.push({
        id: `r-${s(r.id)}`,
        type: "call",
        title: "AI call completed",
        body: `${s(r.lead_name) || leadNoun} — ${OUTCOME_LABEL[s(r.outcome)] ?? "Completed"}`,
        at: s(r.started_at),
        href: "/reports",
      });
    }

    // ── The alert path a failed notification is REQUIRED to have ───────────────
    // An appointment email that exhausted its retries has to reach a human, or
    // the whole "never fails silently" promise is a console.error nobody reads.
    // Only shown to people who could act on it (they manage the calendar), and
    // sorted to the top regardless of age — an unsent booking doesn't get less
    // urgent because it's from yesterday.
    if (viewer.permissions.includes("appointments.manage")) {
      const failed = await listFailedNotifications(viewer.org?.id ?? null);
      for (const f of failed) {
        notifications.unshift({
          id: `n-${f.id}`,
          type: "alert",
          title: `${KIND_LABEL[f.kind] ?? "Notification"} failed to send`,
          body: `${f.leadName} — gave up after ${f.attempts} attempts. ${f.lastError}`,
          at: f.createdAt,
          href: "/appointments",
        });
      }
    }

    const alerts = notifications.filter((n) => n.type === "alert");
    const rest = notifications
      .filter((n) => n.type !== "alert")
      .sort((a, b) => +new Date(b.at) - +new Date(a.at));
    return NextResponse.json({ notifications: [...alerts, ...rest].slice(0, 20) });
  } catch {
    return NextResponse.json({ notifications: [] });
  }
}
