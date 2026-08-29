import "server-only";

import {
  appointments as demoAppointments,
  callbacks as demoCallbacks,
  callRecords as demoCallRecords,
  getLeadById as demoLeadById,
} from "../data";
import { getViewer } from "../org/membership";
import { orgVocabulary } from "../org/vocabulary";
import {
  leadStatusConfig,
  outcomeConfig,
  resolveLeadStatusConfig,
  resolveOutcomeConfig,
} from "../status";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import { formatDuration } from "../utils";
import { getScopedLeadRow } from "./lead-360";

// ─────────────────────────────────────────────────────────────────────────────
// Lead timeline — every interaction with one lead, merged into a single
// reverse-chronological feed: call attempts (human + AI), appointments,
// callbacks, and the lead_events audit trail (status / assignment / DNC /
// field edits / notes), with the import itself as the oldest entry.
//
// The merge is a TS union over the source tables, NOT a SQL view: each source
// needs different describing logic (an appointment's reschedule history, a
// field_change's diff), the per-lead row counts are tiny, and keeping it in TS
// makes the exact merge unit-testable (tests/lead-timeline.test.ts).
//
// mergeTimeline() is the PURE core — mapping, de-duplication, ordering,
// cursoring, capping — and is exported for tests. getLeadTimeline() is the
// DB-facing wrapper with the same scope check as getLeadPanel.
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineKind =
  | "attempt"
  | "status"
  | "note"
  | "callback"
  | "appointment"
  | "assignment"
  | "dnc"
  | "field_change"
  | "import";

export interface TimelineItem {
  id: string;
  /** ISO timestamp the item is ordered by. */
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  actor?: string;
  refs?: {
    callRecordId?: string;
    appointmentId?: string;
    callbackId?: string;
    hasRecording?: boolean;
  };
}

// ── Source shapes (camelCase — the wrapper maps DB rows into these) ──────────

export interface TimelineCallRecord {
  id: string;
  startedAt: string;
  outcome: string | null;
  disposition?: string | null;
  durationSec: number;
  notes?: string | null;
  summary?: string | null;
  hasRecording: boolean;
  conversationId?: string | null;
  failureKind?: string | null;
  channel?: string | null;
}

export interface TimelineAppointment {
  id: string;
  createdAt: string;
  scheduledAt: string | null;
  scheduledLabel?: string | null;
  status: string;
  cancelReason?: string | null;
  /** The PREVIOUS time when the row was rescheduled in place (timestamptz). */
  rescheduledFrom?: string | null;
  source?: string | null;
}

export interface TimelineCallback {
  id: string;
  createdAt: string;
  dueAt: string | null;
  reason?: string | null;
  status: string;
}

export interface TimelineConversation {
  conversationId: string;
  startedAt: string;
  state?: string | null;
  outcome?: string | null;
  summary?: string | null;
  failureKind?: string | null;
}

export interface TimelineLeadEvent {
  id: string;
  createdAt: string;
  kind: string;
  payload?: Record<string, unknown> | null;
  actorName?: string | null;
}

export interface TimelineSources {
  /** The lead itself — becomes the (oldest) "import" item. */
  lead?: { createdAt: string; sourceFile?: string | null } | null;
  callRecords?: TimelineCallRecord[];
  appointments?: TimelineAppointment[];
  callbacks?: TimelineCallback[];
  aiConversations?: TimelineConversation[];
  leadEvents?: TimelineLeadEvent[];
}

export interface MergeTimelineOptions {
  /** Only items STRICTLY older than this ISO timestamp (the "load older" cursor). */
  before?: string | null;
  /** Default 50, hard max 200. */
  limit?: number;
  /** Vocabulary-resolved outcome labels (stored key → words). Neutral defaults otherwise. */
  outcomeLabels?: Record<string, string>;
  /** Vocabulary-resolved lead-status labels. */
  statusLabels?: Record<string, string>;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const KNOWN_EVENT_KINDS: ReadonlySet<string> = new Set([
  "status",
  "assignment",
  "dnc",
  "field_change",
  "note",
  "import",
]);

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** Compact human date for detail lines ("Jun 23, 6:00 PM"). */
function shortWhen(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  return new Date(t).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const join = (parts: (string | null | undefined | false)[]): string =>
  parts.filter(Boolean).join(" · ");

/**
 * Merge every source into one reverse-chronological feed.
 *
 * Guarantees, each pinned by tests:
 *  • strict descending order across all sources;
 *  • same-timestamp items keep their source insertion order
 *    (callRecords → aiConversations → appointments → callbacks → leadEvents → import);
 *  • an AI conversation that already produced a call record is NOT emitted twice;
 *  • a rescheduled appointment is ONE item carrying its history — never a
 *    second entry for the same booking;
 *  • `before` returns only strictly-older items; `limit` caps the page (max 200).
 */
export function mergeTimeline(
  sources: TimelineSources,
  opts: MergeTimelineOptions = {},
): TimelineItem[] {
  const outcomeLabels =
    opts.outcomeLabels ??
    Object.fromEntries(Object.entries(outcomeConfig).map(([k, v]) => [k, v.label]));
  const statusLabels =
    opts.statusLabels ??
    Object.fromEntries(Object.entries(leadStatusConfig).map(([k, v]) => [k, v.label]));
  const outcomeLabel = (key: unknown): string => {
    const k = String(key ?? "");
    return outcomeLabels[k] ?? k.replace(/_/g, " ");
  };
  const statusLabel = (key: unknown): string => {
    const k = String(key ?? "");
    return statusLabels[k] ?? k.replace(/_/g, " ");
  };

  const items: TimelineItem[] = [];

  // Call attempts — one item per call record, human or AI.
  const recordedConversationIds = new Set<string>();
  for (const c of sources.callRecords ?? []) {
    if (c.conversationId) recordedConversationIds.add(c.conversationId);
    const ai = c.channel === "ai";
    const prefix = ai ? "AI call" : "Call";
    const title = c.outcome
      ? `${prefix} — ${outcomeLabel(c.outcome)}`
      : c.failureKind
        ? `${prefix} — didn't complete`
        : `${prefix} attempt`;
    items.push({
      id: `call-${c.id}`,
      at: c.startedAt,
      kind: "attempt",
      title,
      detail: join([
        c.durationSec > 0 && formatDuration(c.durationSec),
        c.notes || c.summary || null,
        !c.outcome && c.failureKind ? `(${String(c.failureKind).replace(/_/g, " ")})` : null,
      ]) || undefined,
      refs: { callRecordId: c.id, hasRecording: c.hasRecording },
    });
  }

  // AI conversations WITHOUT a call record (still live, or failed before one
  // was filed). A conversation that already has a record is skipped — the
  // record above carries the same attempt and emitting both double-counts it.
  for (const conv of sources.aiConversations ?? []) {
    if (recordedConversationIds.has(conv.conversationId)) continue;
    const title = conv.outcome
      ? `AI call — ${outcomeLabel(conv.outcome)}`
      : conv.failureKind
        ? "AI call — didn't complete"
        : `AI call — ${String(conv.state ?? "in progress").replace(/_/g, " ")}`;
    items.push({
      id: `conv-${conv.conversationId}`,
      at: conv.startedAt,
      kind: "attempt",
      title,
      detail:
        join([
          conv.summary || null,
          !conv.outcome && conv.failureKind
            ? `(${String(conv.failureKind).replace(/_/g, " ")})`
            : null,
        ]) || undefined,
    });
  }

  // Appointments — ONE item per booking, whatever its history. A reschedule
  // updates the row in place (rescheduled_from keeps the old time) and a
  // cancellation stamps cancel_reason; both render as history on the single
  // item rather than extra entries.
  for (const a of sources.appointments ?? []) {
    const titles: Record<string, string> = {
      scheduled: "Appointment scheduled",
      completed: "Appointment completed",
      cancelled: "Appointment cancelled",
      no_show: "Appointment no-show",
      rescheduled: "Appointment rescheduled",
    };
    items.push({
      id: `appt-${a.id}`,
      at: a.createdAt,
      kind: "appointment",
      title: titles[a.status] ?? `Appointment ${a.status.replace(/_/g, " ")}`,
      detail:
        join([
          a.scheduledLabel || (a.scheduledAt ? shortWhen(a.scheduledAt) : "no time pinned"),
          a.rescheduledFrom ? `rescheduled from ${shortWhen(a.rescheduledFrom)}` : null,
          a.cancelReason ? `cancelled: ${a.cancelReason}` : null,
          a.source === "ai" ? "booked by AI" : null,
        ]) || undefined,
      refs: { appointmentId: a.id },
    });
  }

  for (const cb of sources.callbacks ?? []) {
    items.push({
      id: `cb-${cb.id}`,
      at: cb.createdAt,
      kind: "callback",
      title: cb.status === "completed" ? "Callback completed" : "Callback scheduled",
      detail:
        join([
          cb.dueAt ? `due ${shortWhen(cb.dueAt)}` : "no time agreed",
          cb.reason || null,
        ]) || undefined,
      refs: { callbackId: cb.id },
    });
  }

  // Audit events (lead_events) — described per kind.
  for (const e of sources.leadEvents ?? []) {
    const p = e.payload ?? {};
    const kind: TimelineKind = KNOWN_EVENT_KINDS.has(e.kind)
      ? (e.kind as TimelineKind)
      : "note";
    let title = "Note updated";
    let detail: string | undefined;
    if (kind === "status") {
      title = `Status → ${statusLabel(p.to)}`;
      detail =
        p.from === "disposition"
          ? `Dispositioned as ${outcomeLabel(p.outcome)}`
          : p.from
            ? `Changed from ${statusLabel(p.from)}`
            : undefined;
    } else if (kind === "assignment") {
      const count = Number(p.count ?? 0);
      title = p.repId ? "Assigned" : "Assignment cleared";
      detail = join([
        p.packId ? "lead pack" : null,
        count > 1 ? `${count} leads in the batch` : null,
      ]) || undefined;
    } else if (kind === "dnc") {
      title = p.action === "removed" ? "Removed from Do Not Call" : "Added to Do Not Call";
      detail = join([
        p.reason ? String(p.reason) : null,
        p.source ? `via ${String(p.source).replace(/_/g, " ")}` : null,
      ]) || undefined;
    } else if (kind === "field_change") {
      const changed = Object.keys((p.changes as Record<string, unknown>) ?? {});
      title = "Details updated";
      detail = changed.length ? changed.join(", ") : undefined;
    } else if (kind === "note") {
      title = p.cleared === true ? "Note cleared" : "Note updated";
      detail = p.preview ? String(p.preview) : undefined;
    } else if (kind === "import") {
      title = "Imported";
      detail = p.sourceFile ? String(p.sourceFile) : undefined;
    }
    items.push({
      id: `evt-${e.id}`,
      at: e.createdAt,
      kind,
      title,
      detail,
      actor: e.actorName || undefined,
    });
  }

  // The lead's own arrival — always the feed's oldest entry.
  if (sources.lead) {
    items.push({
      id: "import",
      at: sources.lead.createdAt,
      kind: "import",
      title: sources.lead.sourceFile
        ? `Imported from ${sources.lead.sourceFile}`
        : "Lead created",
    });
  }

  // Order: newest first; equal timestamps keep insertion order (seq tiebreak —
  // explicit rather than relying on the engine's stable sort).
  const decorated = items.map((item, seq) => ({ item, seq, t: ms(item.at) }));
  decorated.sort((a, b) => (a.t === b.t ? a.seq - b.seq : b.t - a.t));

  const beforeMs = opts.before ? ms(opts.before) : null;
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(opts.limit ?? DEFAULT_LIMIT)));
  const paged = decorated
    .filter((d) => (beforeMs == null ? true : d.t < beforeMs))
    .slice(0, limit);
  return paged.map((d) => d.item);
}

// ── DB wrapper ───────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v == null ? null : String(v));

function demoTimeline(
  leadId: string,
  opts: { before?: string | null; limit?: number },
): TimelineItem[] | null {
  const lead = demoLeadById(leadId);
  if (!lead) return null;
  return mergeTimeline(
    {
      lead: { createdAt: lead.createdAt, sourceFile: null },
      callRecords: demoCallRecords
        .filter((c) => c.leadId === leadId)
        .map((c) => ({
          id: c.id,
          startedAt: c.startedAt,
          outcome: c.outcome,
          disposition: c.disposition,
          durationSec: c.durationSec,
          hasRecording: Boolean(c.recordingUrl && c.recordingUrl !== "#"),
        })),
      // Sample rows carry no created_at; the scheduled/due time is the honest stand-in.
      appointments: demoAppointments
        .filter((a) => a.leadId === leadId)
        .map((a) => ({
          id: a.id,
          createdAt: a.scheduledAt,
          scheduledAt: a.scheduledAt,
          status: a.status,
          source: a.source,
        })),
      callbacks: demoCallbacks
        .filter((c) => c.leadId === leadId)
        .map((c) => ({ id: c.id, createdAt: c.dueAt, dueAt: c.dueAt, reason: c.reason, status: c.status })),
    },
    opts,
  );
}

/**
 * The lead's merged timeline, newest first — same scope rules as getLeadPanel
 * (null when the viewer may not see this lead). `before` + `limit` page it.
 */
export async function getLeadTimeline(
  leadId: string,
  opts: { before?: string | null; limit?: number } = {},
): Promise<TimelineItem[] | null> {
  if (!isSupabaseConfigured()) return demoTimeline(leadId, opts);

  const access = await getScopedLeadRow(leadId);
  if (!access.ok) return null;
  const { row } = access;

  try {
    const db = isAdminConfigured() ? createAdminClient() : await createClient();
    const orgId = str(row.org_id);

    const [recs, appts, cbs, convos, events] = await Promise.all([
      db
        .from("call_records")
        .select(
          "id,started_at,outcome,disposition,duration_sec,notes,summary,recording_url,conversation_id,failure_kind,channel",
        )
        .eq("lead_id", leadId)
        .order("started_at", { ascending: false })
        .limit(200),
      db
        .from("appointments")
        .select("id,created_at,scheduled_at,scheduled_label,status,cancel_reason,rescheduled_from,source")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("callbacks")
        .select("id,created_at,due_at,reason,status")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(100),
      db
        .from("ai_conversations")
        .select("conversation_id,started_at,state,outcome,summary,failure_kind")
        .eq("lead_id", leadId)
        .order("started_at", { ascending: false })
        .limit(100),
      db
        .from("lead_events")
        .select("id,created_at,kind,payload,actor_id")
        .eq("lead_id", leadId)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    // Actor display names for the audit entries.
    const eventRows = ((events.data ?? []) as Row[]);
    const actorIds = [
      ...new Set(eventRows.map((e) => str(e.actor_id)).filter(Boolean)),
    ] as string[];
    let nameById = new Map<string, string>();
    if (actorIds.length && orgId) {
      const { data: members } = await db
        .from("organization_members")
        .select("user_id,name")
        .eq("org_id", orgId)
        .in("user_id", actorIds);
      nameById = new Map(
        ((members ?? []) as Row[]).map((m) => [String(m.user_id), String(m.name ?? "")]),
      );
    }

    // The workspace's own words for outcomes/statuses in titles.
    const viewer = await getViewer();
    const vocab = orgVocabulary(viewer.org);
    const outcomeLabels = Object.fromEntries(
      Object.entries(resolveOutcomeConfig(vocab)).map(([k, v]) => [k, v.label]),
    );
    const statusLabels = Object.fromEntries(
      Object.entries(resolveLeadStatusConfig(vocab)).map(([k, v]) => [k, v.label]),
    );

    return mergeTimeline(
      {
        lead: {
          createdAt: String(row.created_at ?? new Date().toISOString()),
          sourceFile: str(row.source_file),
        },
        callRecords: ((recs.data ?? []) as Row[]).map((r) => ({
          id: String(r.id),
          startedAt: String(r.started_at ?? ""),
          outcome: str(r.outcome),
          disposition: str(r.disposition),
          durationSec: Number(r.duration_sec ?? 0),
          notes: str(r.notes),
          summary: str(r.summary),
          hasRecording: Boolean(r.recording_url),
          conversationId: str(r.conversation_id),
          failureKind: str(r.failure_kind),
          channel: str(r.channel),
        })),
        appointments: ((appts.data ?? []) as Row[]).map((r) => ({
          id: String(r.id),
          createdAt: String(r.created_at ?? ""),
          scheduledAt: str(r.scheduled_at),
          scheduledLabel: str(r.scheduled_label),
          status: String(r.status ?? "scheduled"),
          cancelReason: str(r.cancel_reason),
          rescheduledFrom: str(r.rescheduled_from),
          source: str(r.source),
        })),
        callbacks: ((cbs.data ?? []) as Row[]).map((r) => ({
          id: String(r.id),
          createdAt: String(r.created_at ?? ""),
          dueAt: str(r.due_at),
          reason: str(r.reason),
          status: String(r.status ?? "due"),
        })),
        aiConversations: ((convos.data ?? []) as Row[]).map((r) => ({
          conversationId: String(r.conversation_id),
          startedAt: String(r.started_at ?? ""),
          state: str(r.state),
          outcome: str(r.outcome),
          summary: str(r.summary),
          failureKind: str(r.failure_kind),
        })),
        leadEvents: eventRows.map((r) => ({
          id: String(r.id),
          createdAt: String(r.created_at ?? ""),
          kind: String(r.kind ?? "note"),
          payload:
            r.payload && typeof r.payload === "object"
              ? (r.payload as Record<string, unknown>)
              : null,
          actorName: r.actor_id ? nameById.get(String(r.actor_id)) || null : null,
        })),
      },
      { before: opts.before, limit: opts.limit, outcomeLabels, statusLabels },
    );
  } catch {
    return [];
  }
}
