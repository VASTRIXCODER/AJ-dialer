import "server-only";

import { CONNECTED_OUTCOMES } from "../call-analytics";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { isSupabaseConfigured } from "../supabase/config";
import { createClient } from "../supabase/server";
import type { CallOutcome } from "../types";
import { readProfileScope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// The call archive — every recording and transcript the workspace has, findable.
//
// Reports already listed calls, but only as an unfiltered newest-first feed you
// paged through 50 at a time. There was no way to search, no way to narrow to a
// rep or a date or an outcome, and no way at all to find a call by something
// that was SAID on it. This is the query layer that makes the archive an actual
// archive: server-side filtering + substring search across the lead's name, the
// phone, the AI summary, the rep's notes, and the transcript itself.
//
// Scope matches every other reporting read: supervisors see the org, reps see
// their own calls, and a rep's "own" is still fenced to their CURRENT org.
// ─────────────────────────────────────────────────────────────────────────────

export interface ArchiveCall {
  id: string;
  leadId: string | null;
  leadName: string;
  phone: string;
  channel: "ai" | "human";
  repId: string | null;
  repName?: string;
  outcome: CallOutcome | null;
  durationSec: number;
  startedAt: string;
  sentiment: string | null;
  summary: string | null;
  /** The rep's notes from THIS call (not the lead's current note). */
  notes: string | null;
  /** Playable URL — already proxied for Twilio media. Null when there is none. */
  recordingUrl: string | null;
  hasRecording: boolean;
  conversationId: string | null;
  hasTranscript: boolean;
  /** A short window of transcript around the search term, when searching. */
  transcriptSnippet: string | null;
}

export type ArchiveChannel = "all" | "ai" | "human";
export type ArchiveMedia = "all" | "recording" | "transcript";

export interface ArchiveQuery {
  /** Free text across name, phone, summary, notes and transcript. */
  q?: string;
  channel?: ArchiveChannel;
  outcome?: string;
  /** Owner id, or "all". Only meaningful for supervisors. */
  repId?: string;
  /** Inclusive ISO dates (YYYY-MM-DD). */
  from?: string;
  to?: string;
  media?: ArchiveMedia;
  offset?: number;
  limit?: number;
}

export interface ArchivePage {
  calls: ArchiveCall[];
  /** Exact total for the current filter — drives the count and the pager. */
  total: number;
  hasMore: boolean;
  scope: "org" | "own";
  /** True when the archive can't be read at all (Supabase unconfigured). */
  unavailable: boolean;
}

const EMPTY: ArchivePage = {
  calls: [],
  total: 0,
  hasMore: false,
  scope: "own",
  unavailable: true,
};

type Row = Record<string, unknown>;

/**
 * PostgREST's `or=` filter is a comma-separated list wrapped in parentheses, so
 * a comma or a bracket in the user's search text terminates the filter early and
 * the request 400s (or, worse, silently means something else). Quotes delimit a
 * value, and `%` / `_` are ILIKE wildcards. Strip the grammar characters and
 * neutralize the wildcards — a rep typing "50%" wants the digits and the sign,
 * not a pattern.
 */
export function sanitizeSearch(raw: string): string {
  return raw
    .trim()
    .slice(0, 120)
    .replace(/[(),*"']/g, " ")
    .replace(/[%_\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ~160 characters of transcript centred on the first match, so a result row
 * shows WHY it matched instead of making the reader open every call to find out.
 */
export function transcriptSnippet(text: string | null, term: string): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, " ").trim();
  if (!flat) return null;
  if (!term) return flat.slice(0, 160) + (flat.length > 160 ? "…" : "");
  const at = flat.toLowerCase().indexOf(term.toLowerCase());
  if (at === -1) return null;
  const start = Math.max(0, at - 60);
  const end = Math.min(flat.length, at + term.length + 100);
  return (
    (start > 0 ? "…" : "") + flat.slice(start, end) + (end < flat.length ? "…" : "")
  );
}

/**
 * Turn a stored Twilio recording URL into our authenticated proxy path so the
 * browser can play it (raw Twilio media is private and 401s). Leaves anything
 * that isn't a Twilio recording URL (e.g. already-proxied paths) untouched.
 */
function toPlayableRecording(raw: string | null): string | null {
  if (!raw) return null;
  const m = /\/Recordings\/(RE[0-9a-f]{32})/i.exec(raw);
  return m ? `/api/twilio/recording/${m[1]}` : raw;
}

const SELECT =
  "id,owner_id,lead_id,lead_name,phone,outcome,duration_sec,channel,started_at," +
  "conversation_id,recording_url,summary,sentiment,notes,transcript_text";

export async function searchCallArchive(query: ArchiveQuery): Promise<ArchivePage> {
  if (!isSupabaseConfigured()) return EMPTY;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return EMPTY;

    // Supervisor comes from the membership row for the ACTIVE org, never from
    // profiles.role — that column is a stale copy. See resolveSupervisor.
    const prof = await readProfileScope(supabase, user.id);
    const orgId = prof.org_id;
    const supervisor = Boolean(orgId && prof.supervisor && isAdminConfigured());
    const reader = supervisor ? createAdminClient() : supabase;
    const scope: "org" | "own" = supervisor ? "org" : "own";

    const limit = Math.min(100, Math.max(1, Math.floor(query.limit ?? 25)));
    const offset = Math.max(0, Math.floor(query.offset ?? 0));
    const term = sanitizeSearch(query.q ?? "");

    // `count: "exact"` is what lets the UI say "312 calls match" rather than
    // "here are some" — the difference between an archive and a feed.
    let q = reader
      .from("call_records")
      .select(SELECT, { count: "exact" })
      .eq(supervisor ? "org_id" : "owner_id", supervisor ? (orgId as string) : user.id);
    if (!supervisor && orgId) q = q.eq("org_id", orgId);

    // A supervisor narrowing to one rep. Reps can't widen past themselves — the
    // owner_id filter above already fences them regardless of what they send.
    if (supervisor && query.repId && query.repId !== "all") {
      q = q.eq("owner_id", query.repId);
    }
    if (query.channel === "ai") q = q.eq("channel", "ai");
    // Legacy rows predate the channel column and are human by convention
    // (matching channelBreakdown), so "human" is "not ai", not `eq('human')`.
    else if (query.channel === "human") q = q.or("channel.is.null,channel.eq.human");

    if (query.outcome && query.outcome !== "all") q = q.eq("outcome", query.outcome);
    if (query.from) q = q.gte("started_at", `${query.from}T00:00:00.000Z`);
    // The `to` bound is INCLUSIVE of the whole day — a rep picking the same date
    // for both ends means "that day", not "an empty range".
    if (query.to) q = q.lte("started_at", `${query.to}T23:59:59.999Z`);

    // "Has a recording" is NOT `recording_url is not null`. Only manual calls
    // store a Twilio URL; an AI call's audio is fetched from the provider by
    // conversation id and exists exactly when the call connected. Filtering on
    // the column alone would have hidden every AI recording in the workspace —
    // which, for an AI-heavy floor, is most of the archive.
    if (query.media === "recording") {
      const connected = [...CONNECTED_OUTCOMES].join(",");
      q = q.or(
        `recording_url.not.is.null,and(conversation_id.not.is.null,outcome.in.(${connected}))`,
      );
    } else if (query.media === "transcript") {
      q = q.not("transcript_text", "is", null);
    }

    if (term) {
      const like = `%${term}%`;
      q = q.or(
        [
          `lead_name.ilike.${like}`,
          `phone.ilike.${like}`,
          `summary.ilike.${like}`,
          `notes.ilike.${like}`,
          `transcript_text.ilike.${like}`,
        ].join(","),
      );
    }

    const { data, error, count } = await q
      .order("started_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) {
      console.error("[call-archive] query failed:", error.message);
      return { ...EMPTY, scope, unavailable: false };
    }

    let nameById = new Map<string, string>();
    if (supervisor && orgId) {
      const { data: mem } = await createAdminClient()
        .from("organization_members")
        .select("user_id,name")
        .eq("org_id", orgId)
        .eq("status", "active");
      nameById = new Map(
        ((mem ?? []) as unknown as Row[]).map((m) => [
          String(m.user_id),
          String(m.name ?? ""),
        ]),
      );
    }

    const rows = (data ?? []) as unknown as Row[];
    const total = count ?? rows.length;
    return {
      calls: rows.map((r) => mapArchiveRow(r, supervisor, nameById, term)),
      total,
      hasMore: offset + rows.length < total,
      scope,
      unavailable: false,
    };
  } catch (e) {
    console.error(
      "[call-archive] searchCallArchive failed:",
      e instanceof Error ? e.message : e,
    );
    return { ...EMPTY, unavailable: false };
  }
}

function mapArchiveRow(
  r: Row,
  supervisor: boolean,
  nameById: Map<string, string>,
  term: string,
): ArchiveCall {
  const outcome = (r.outcome as CallOutcome) ?? null;
  const channel = r.channel === "ai" ? "ai" : "human";
  const conversationId = (r.conversation_id as string) ?? null;
  const rawRecording = (r.recording_url as string) ?? null;
  const transcriptText = (r.transcript_text as string) ?? null;

  // An AI call's audio comes from the provider by conversation id; a manual
  // call's comes from Twilio through our authenticated proxy. Neither exists
  // unless somebody actually picked up, so a call that never connected offers no
  // dead Play button.
  const connected = Boolean(outcome && CONNECTED_OUTCOMES.has(outcome));
  const recordingUrl =
    channel === "ai"
      ? conversationId && connected
        ? `/api/elevenlabs/audio/${encodeURIComponent(conversationId)}`
        : null
      : toPlayableRecording(rawRecording);

  return {
    id: String(r.id),
    leadId: (r.lead_id as string) ?? null,
    leadName: String(r.lead_name ?? "").trim(),
    phone: String(r.phone ?? ""),
    channel,
    repId: (r.owner_id as string) ?? null,
    repName: supervisor ? nameById.get(String(r.owner_id)) || "Rep" : undefined,
    outcome,
    durationSec: Number(r.duration_sec ?? 0),
    startedAt: String(r.started_at ?? new Date().toISOString()),
    sentiment: (r.sentiment as string) ?? null,
    summary: (r.summary as string) ?? null,
    notes: (r.notes as string) ?? null,
    recordingUrl,
    hasRecording: Boolean(recordingUrl),
    conversationId,
    hasTranscript: Boolean(transcriptText),
    transcriptSnippet: term ? transcriptSnippet(transcriptText, term) : null,
  };
}

/** One stored transcript turn, with its offset when the provider reported one. */
export interface ArchiveTranscriptTurn {
  role: string;
  message: string;
  /** Seconds from call start — what makes a turn seekable. Null on legacy rows. */
  secs: number | null;
}

/** Provenance for the summary shown in the detail view (F1 artifacts). */
export interface ArchiveSummaryMeta {
  source: "ai" | "human";
  model: string | null;
  createdAt: string;
  /** Resolved for human-authored rows — the "Edited by <name>" line. */
  editorName: string | null;
}

export interface ArchiveCallDetail extends ArchiveCall {
  transcriptText: string | null;
  /**
   * The per-turn transcript WITH timestamps, preferred over the flat text when
   * present: call_transcript_segments first (the live relay wrote them with
   * secs), else the conversation's stored turn array. Null for manual calls
   * and legacy AI rows — the modal falls back to parsing transcriptText,
   * honestly without the seek affordance.
   */
  transcriptTurns: ArchiveTranscriptTurn[] | null;
  /** Null when no summary artifact exists (legacy calls). */
  summaryMeta: ArchiveSummaryMeta | null;
  /** May THIS viewer edit the summary (supervisors)? Drives the affordance. */
  canEditSummary: boolean;
}

/**
 * One call with its FULL transcript — the detail view's read. Kept separate from
 * the list query so a page of 25 results never ships 25 full transcripts to the
 * browser just in case one of them gets opened.
 */
export async function getArchivedCall(
  id: string,
): Promise<ArchiveCallDetail | null> {
  if (!isSupabaseConfigured() || !id) return null;
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // Supervisor comes from the membership row for the ACTIVE org, never from
    // profiles.role — that column is a stale copy. See resolveSupervisor.
    const prof = await readProfileScope(supabase, user.id);
    const orgId = prof.org_id;
    const supervisor = Boolean(orgId && prof.supervisor && isAdminConfigured());
    const reader = supervisor ? createAdminClient() : supabase;

    // The scope filter is the authorization: a rep asking for another rep's call
    // id gets nothing back, and a supervisor is fenced to their own org.
    let q = reader.from("call_records").select(SELECT).eq("id", id);
    q = supervisor ? q.eq("org_id", orgId as string) : q.eq("owner_id", user.id);
    const { data } = await q.maybeSingle();
    if (!data) return null;

    const row = data as unknown as Row;
    let repName = "";
    if (supervisor && orgId) {
      const { data: mem } = await createAdminClient()
        .from("organization_members")
        .select("name")
        .eq("org_id", orgId)
        .eq("user_id", String(row.owner_id))
        .maybeSingle();
      repName = String((mem as unknown as Row | null)?.name ?? "");
    }
    const mapped = mapArchiveRow(
      row,
      supervisor,
      new Map(repName ? [[String(row.owner_id), repName]] : []),
      "",
    );

    // ── Per-turn transcript with secs (F1: audio ↔ transcript sync) ──────────
    // Prefer the immutable segment store (the live relay wrote each turn with
    // its offset); fall back to the conversation's persisted turn array (also
    // carries secs); manual/legacy calls get null and the modal parses the
    // flat text without a seek affordance — the honest fallback.
    const conversationId = (row.conversation_id as string) ?? null;
    let transcriptTurns: ArchiveTranscriptTurn[] | null = null;
    if (conversationId) {
      try {
        const { data: segs } = await reader
          .from("call_transcript_segments")
          .select("turn_index, role, message, secs")
          .eq("conversation_id", conversationId)
          .order("turn_index", { ascending: true })
          .limit(500);
        const segRows = (segs ?? []) as unknown as Row[];
        if (segRows.length > 0) {
          transcriptTurns = segRows.map((s) => ({
            role: String(s.role ?? "agent"),
            message: String(s.message ?? ""),
            secs: s.secs == null ? null : Number(s.secs),
          }));
        }
      } catch {
        /* segments table absent — fall through */
      }
      if (!transcriptTurns) {
        try {
          const { data: convo } = await reader
            .from("ai_conversations")
            .select("transcript")
            .eq("conversation_id", conversationId)
            .maybeSingle();
          const turns = (convo as Row | null)?.transcript;
          if (Array.isArray(turns) && turns.length > 0) {
            transcriptTurns = (turns as Row[])
              .map((t) => ({
                role: String(t.role ?? "agent"),
                message: String(t.message ?? ""),
                secs: t.secs == null || !Number.isFinite(Number(t.secs)) ? null : Number(t.secs),
              }))
              .filter((t) => t.message.trim().length > 0);
            if (transcriptTurns.length === 0) transcriptTurns = null;
          }
        } catch {
          /* keep null */
        }
      }
    }

    // ── Summary provenance (F1: AI-vs-human notes) ───────────────────────────
    let summaryMeta: ArchiveSummaryMeta | null = null;
    try {
      const { data: art } = await reader
        .from("call_artifacts")
        .select("source, model, created_at, created_by")
        .eq("call_record_id", id)
        .eq("kind", "summary")
        .eq("status", "active")
        .limit(1)
        .maybeSingle();
      if (art) {
        const a = art as unknown as Row;
        const source = a.source === "human" ? "human" : "ai";
        let editorName: string | null = null;
        if (source === "human" && a.created_by && orgId && isAdminConfigured()) {
          const { data: mem } = await createAdminClient()
            .from("organization_members")
            .select("name")
            .eq("org_id", orgId)
            .eq("user_id", String(a.created_by))
            .maybeSingle();
          editorName = String((mem as unknown as Row | null)?.name ?? "") || null;
        }
        summaryMeta = {
          source,
          model: (a.model as string) ?? null,
          createdAt: String(a.created_at ?? ""),
          editorName,
        };
      }
    } catch {
      /* artifacts table absent — provenance simply doesn't render */
    }

    return {
      ...mapped,
      transcriptText: (row.transcript_text as string) ?? null,
      transcriptTurns,
      summaryMeta,
      canEditSummary: supervisor,
    };
  } catch {
    return null;
  }
}
