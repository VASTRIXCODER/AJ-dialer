import "server-only";

import { dncKey, getDncDigits, isOnDnc } from "./dnc";
import { getConsent } from "./consent";
import { resolveLeadTimezone, timezoneForAreaCode } from "../dialer/lead-timezone";
import { areaCodeOf } from "../dialer/rotation";
import { isMessagingConfigured } from "../messaging/config";
import {
  evaluateSendGate,
  type SendDenial,
  type SendGateInput,
  type SendVerdict,
} from "../messaging/send-gate";
import { countSegments } from "../messaging/render";
import type { ConsentScope } from "../consent/state";
import type { OrgFull } from "../org/membership";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import { count } from "../telemetry";
import { orgTimezone } from "../metrics/definitions";

// ─────────────────────────────────────────────────────────────────────────────
// Messages, threads, and the context the send gate needs to judge one.
//
// Every write here goes through the service-role client after an
// application-code permission check, because the messages tables carry a
// SELECT-only RLS policy — deliberately, so nothing can be written by a client
// holding the anon key.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

const DAY_MS = 86_400_000;

export interface MessageRow {
  id: string;
  orgId: string;
  threadId: string;
  leadId: string | null;
  direction: "outbound" | "inbound";
  status: string;
  body: string;
  scope: ConsentScope;
  fromNumber: string | null;
  toNumber: string | null;
  providerSid: string | null;
  errorMessage: string | null;
  blockedReasons: string[];
  approvedBy: string | null;
  approvedAt: string | null;
  createdBy: string | null;
  templateKey: string | null;
  segments: number | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
}

function mapMessage(r: Row): MessageRow {
  return {
    id: s(r.id),
    orgId: s(r.org_id),
    threadId: s(r.thread_id),
    leadId: r.lead_id ? s(r.lead_id) : null,
    direction: s(r.direction) === "inbound" ? "inbound" : "outbound",
    status: s(r.status),
    body: s(r.body),
    scope: s(r.scope) === "promotional" ? "promotional" : "transactional",
    fromNumber: r.from_number ? s(r.from_number) : null,
    toNumber: r.to_number ? s(r.to_number) : null,
    providerSid: r.provider_sid ? s(r.provider_sid) : null,
    errorMessage: r.error_message ? s(r.error_message) : null,
    blockedReasons: Array.isArray(r.blocked_reasons) ? (r.blocked_reasons as string[]) : [],
    approvedBy: r.approved_by ? s(r.approved_by) : null,
    approvedAt: r.approved_at ? s(r.approved_at) : null,
    createdBy: r.created_by ? s(r.created_by) : null,
    templateKey: r.template_key ? s(r.template_key) : null,
    segments: r.segments == null ? null : n(r.segments),
    createdAt: s(r.created_at),
    sentAt: r.sent_at ? s(r.sent_at) : null,
    deliveredAt: r.delivered_at ? s(r.delivered_at) : null,
  };
}

/**
 * Find or create the conversation with this person.
 *
 * `senderNumber` is written once and then LEFT ALONE. Caller-ID rotation is
 * right for dialing and wrong for a conversation: a reply has to come from the
 * number they were texted from, or the thread scatters across eleven numbers
 * and the customer has no idea who is contacting them.
 */
export async function ensureThread(input: {
  orgId: string;
  phone: string;
  leadId?: string | null;
  opportunityId?: string | null;
  senderNumber?: string | null;
  ambiguousMatch?: boolean;
}): Promise<{ id: string; senderNumber: string | null } | null> {
  const digits = dncKey(input.phone);
  if (!input.orgId || !digits || !isAdminConfigured()) return null;
  try {
    const admin = createAdminClient();
    const { data: existing } = await admin
      .from("message_threads")
      .select("id, sender_number, lead_id")
      .eq("org_id", input.orgId)
      .eq("contact_digits", digits)
      .eq("channel", "sms")
      .maybeSingle();

    if (existing) {
      const patch: Row = { updated_at: new Date().toISOString() };
      // Fill a gap; never overwrite a sender the thread already committed to.
      if (!existing.sender_number && input.senderNumber) {
        patch.sender_number = input.senderNumber;
      }
      if (!existing.lead_id && input.leadId) patch.lead_id = input.leadId;
      if (input.ambiguousMatch != null) patch.ambiguous_match = input.ambiguousMatch;
      if (Object.keys(patch).length > 1) {
        await admin.from("message_threads").update(patch).eq("id", s(existing.id));
      }
      return {
        id: s(existing.id),
        senderNumber: (existing.sender_number ? s(existing.sender_number) : null) ??
          input.senderNumber ?? null,
      };
    }

    const { data: created, error } = await admin
      .from("message_threads")
      .insert({
        org_id: input.orgId,
        contact_digits: digits,
        channel: "sms",
        lead_id: input.leadId ?? null,
        opportunity_id: input.opportunityId ?? null,
        sender_number: input.senderNumber ?? null,
        ambiguous_match: input.ambiguousMatch ?? false,
      })
      .select("id, sender_number")
      .maybeSingle();

    if (error) {
      // 23505: another request created it in the same instant. Re-read rather
      // than failing — two people opening one conversation is not an error.
      const { data: raced } = await admin
        .from("message_threads")
        .select("id, sender_number")
        .eq("org_id", input.orgId)
        .eq("contact_digits", digits)
        .eq("channel", "sms")
        .maybeSingle();
      return raced
        ? { id: s(raced.id), senderNumber: raced.sender_number ? s(raced.sender_number) : null }
        : null;
    }
    return created
      ? { id: s(created.id), senderNumber: created.sender_number ? s(created.sender_number) : null }
      : null;
  } catch {
    count("messaging.thread_fail", 1, { orgId: input.orgId });
    return null;
  }
}

export interface SendContext {
  input: Omit<SendGateInput, "now" | "body" | "approvedBy" | "requiredScope">;
  /** Everything already resolved, so the gate can be re-run at drain cheaply. */
  senderNumber: string | null;
}

/**
 * Assemble everything the gate needs to judge a send to one number.
 *
 * Called at proposal AND again at drain. The second call is the point: DNC,
 * consent and the caps are all re-read, so anything that changed while the
 * message waited for a human is caught before it reaches the carrier.
 */
export async function buildSendContext(input: {
  org: OrgFull | null;
  orgId: string;
  toPhone: string;
  senderNumber: string | null;
  leadTimezone?: string | null;
  now?: Date;
}): Promise<SendContext> {
  const now = input.now ?? new Date();
  const messaging = input.org?.settings.messaging;
  const orgTz = orgTimezone(input.org);

  // BOTH candidate zones, not a choice between them. See the gate: when they
  // disagree the message must be inside the window in each.
  const stored = (input.leadTimezone ?? "").trim();
  const candidates = new Set<string>();
  if (stored.includes("/")) candidates.add(stored);
  const byArea = timezoneForAreaCode(areaCodeOf(input.toPhone));
  if (byArea) candidates.add(byArea);
  if (!candidates.size) {
    // Nothing resolved from the number or the record. resolveLeadTimezone's
    // fallback is the org's own zone — better than nothing, and named so the
    // gate is not evaluating an empty list.
    candidates.add(resolveLeadTimezone(input.toPhone, input.leadTimezone, orgTz));
  }

  const [isDnc, consent, contactToday, contactWeek, orgToday] = await Promise.all([
    isOnDnc(input.orgId, input.toPhone),
    getConsent(input.orgId, input.toPhone, "sms"),
    countAcceptedSends(input.orgId, input.toPhone, new Date(now.getTime() - DAY_MS)),
    countAcceptedSends(input.orgId, input.toPhone, new Date(now.getTime() - 7 * DAY_MS)),
    countOrgAcceptedSends(input.orgId, new Date(now.getTime() - DAY_MS)),
  ]);

  return {
    senderNumber: input.senderNumber,
    input: {
      toPhone: input.toPhone,
      senderNumber: input.senderNumber,
      isDnc,
      consent,
      candidateTimezones: [...candidates],
      quietHours: messaging?.quietHours ?? null,
      contactSentToday: contactToday,
      contactSentThisWeek: contactWeek,
      orgSentToday: orgToday,
      caps: {
        perContactPerDay: messaging?.perContactPerDay ?? 0,
        perContactPer7Days: messaging?.perContactPer7Days ?? 0,
        perOrgPerDay: messaging?.dailyOrgCap ?? 0,
      },
      messagingConfigured: isMessagingConfigured(),
      orgMessagingEnabled: messaging?.enabled === true,
      messagingPaused: await isMessagingPaused(),
      templateRequired: false,
      templatePublished: true,
      unresolvedVariables: [],
    },
  };
}

/** Run the gate for a specific body and approver against a prepared context. */
export function judgeSend(
  ctx: SendContext,
  opts: {
    now?: Date;
    body: string;
    requiredScope: ConsentScope;
    approvedBy: string | null;
    templateRequired?: boolean;
    templatePublished?: boolean;
    unresolvedVariables?: string[];
  },
): SendVerdict {
  return evaluateSendGate({
    ...ctx.input,
    now: opts.now ?? new Date(),
    body: opts.body,
    requiredScope: opts.requiredScope,
    approvedBy: opts.approvedBy,
    templateRequired: opts.templateRequired ?? ctx.input.templateRequired,
    templatePublished: opts.templatePublished ?? ctx.input.templatePublished,
    unresolvedVariables: opts.unresolvedVariables ?? ctx.input.unresolvedVariables,
  });
}

/**
 * Sends to this number the carrier ACCEPTED since `since`.
 *
 * `provider_sid is not null` is the line: a message the gate blocked, or one
 * that failed before Twilio took it, never reached the person and must not
 * count against what they are willing to receive.
 */
export async function countAcceptedSends(
  orgId: string,
  phone: string,
  since: Date,
): Promise<number> {
  if (!isAdminConfigured() || !orgId) return 0;
  const digits = dncKey(phone);
  if (!digits) return 0;
  try {
    const admin = createAdminClient();
    // Keyed on the thread's contact digits rather than to_number, so duplicate
    // lead rows for one human cannot double their allowance.
    const { data: threads, error: threadsErr } = await admin
      .from("message_threads")
      .select("id")
      .eq("org_id", orgId)
      .eq("contact_digits", digits);
    // Fails CLOSED, like the count below it. This read was unchecked, so a
    // resolved error produced no thread ids, the early return said "nothing
    // sent today", and the per-contact cap read as completely unspent — the
    // cap's own catch already returns MAX_SAFE_INTEGER for exactly this
    // reason, and the first of its two reads was skipping that.
    if (threadsErr) return Number.MAX_SAFE_INTEGER;
    const ids = ((threads ?? []) as Row[]).map((t) => s(t.id));
    if (!ids.length) return 0;
    const { count: c, error } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .in("thread_id", ids)
      .eq("direction", "outbound")
      .not("provider_sid", "is", null)
      .gte("created_at", since.toISOString());
    // The `catch` below is NOT enough on its own: supabase-js does not throw on
    // a PostgREST or network failure, it RESOLVES with `{ count: null, error }`.
    // So `c ?? 0` reported the cap as completely unspent every time the count
    // failed — the fail-OPEN direction, on a limit that exists to stop us
    // texting someone too often.
    if (error) return Number.MAX_SAFE_INTEGER;
    return c ?? 0;
  } catch {
    // Fail CLOSED on a counting error: pretend the cap is spent rather than
    // pretend it is free.
    return Number.MAX_SAFE_INTEGER;
  }
}

export async function countOrgAcceptedSends(orgId: string, since: Date): Promise<number> {
  if (!isAdminConfigured() || !orgId) return 0;
  try {
    const admin = createAdminClient();
    const { count: c, error } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("direction", "outbound")
      .not("provider_sid", "is", null)
      .gte("created_at", since.toISOString());
    // Same trap as countAcceptedSends: a resolved error must not read as zero.
    if (error) return Number.MAX_SAFE_INTEGER;
    return c ?? 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

/** The platform-wide messaging kill switch. Defaults to PAUSED on any doubt. */
export async function isMessagingPaused(): Promise<boolean> {
  if (!isAdminConfigured()) return true;
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("app_settings")
      .select("messaging_paused")
      .eq("id", "global")
      .maybeSingle();
    // A read that FAILED is doubt, and the docstring above says what doubt
    // means here. This returned `data?.messaging_paused === true` from an
    // unchecked destructure, so a database incident — the exact situation the
    // switch exists for — read as "not paused" and sending continued.
    //
    // A missing column or a missing row is different, and still reads as not
    // paused: the switch has to be turned ON deliberately, and an unapplied
    // migration must not silently stop a workspace that has messaging
    // configured and enabled.
    if (error) return true;
    return data?.messaging_paused === true;
  } catch {
    return true;
  }
}

export interface ProposeMessageInput {
  orgId: string;
  threadId: string;
  leadId?: string | null;
  opportunityId?: string | null;
  toNumber: string;
  fromNumber: string | null;
  body: string;
  scope: ConsentScope;
  createdBy: string | null;
  /** Set to self-approve (a rep's own 1:1). Null leaves it needing approval. */
  approvedBy?: string | null;
  templateId?: string | null;
  templateKey?: string | null;
  templateVersion?: number | null;
  /** Exactly-once creation for automation. Omitted for a human's own message. */
  idempotencyKey?: string | null;
  sourceKind?: string;
  sourceId?: string;
  /** Gate reasons at proposal time, when it was refused outright. */
  blockedReasons?: SendDenial[];
}

/**
 * Create a message. Status is decided here and nowhere else:
 *   • blocked  — the gate refused it outright, so it is recorded and closed;
 *   • approved — self-approved by its author (a rep's 1:1);
 *   • needs_approval — everything the automation proposes.
 *
 * Returns null when a replay hit the idempotency key, which is the SUCCESS case
 * for a retried tick: the message already exists and must not be duplicated.
 */
export async function proposeMessage(
  input: ProposeMessageInput,
): Promise<MessageRow | null> {
  if (!isAdminConfigured() || !input.orgId) return null;
  const blocked = (input.blockedReasons ?? []).length > 0;
  const status = blocked
    ? "blocked"
    : input.approvedBy
      ? "approved"
      : "needs_approval";
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("messages")
      .insert({
        org_id: input.orgId,
        thread_id: input.threadId,
        lead_id: input.leadId ?? null,
        opportunity_id: input.opportunityId ?? null,
        direction: "outbound",
        channel: "sms",
        status,
        body: input.body,
        scope: input.scope,
        from_number: input.fromNumber,
        to_number: input.toNumber,
        template_id: input.templateId ?? null,
        template_key: input.templateKey ?? null,
        template_version: input.templateVersion ?? null,
        idempotency_key: input.idempotencyKey ?? null,
        created_by: input.createdBy,
        approved_by: blocked ? null : (input.approvedBy ?? null),
        approved_at: !blocked && input.approvedBy ? new Date().toISOString() : null,
        blocked_reasons: input.blockedReasons ?? null,
        segments: countSegments(input.body),
        source_kind: input.sourceKind ?? null,
        source_id: input.sourceId ?? null,
        next_attempt_at: status === "approved" ? new Date().toISOString() : null,
      })
      .select("*")
      .maybeSingle();
    if (error || !data) return null;
    return mapMessage(data as Row);
  } catch {
    count("messaging.propose_fail", 1, { orgId: input.orgId });
    return null;
  }
}

/**
 * Who wrote each of these messages, for the approval permission split.
 *
 * `created_by` is null for anything the automation proposed and set to the
 * author for a rep's own 1:1. It is written once at insert and never updated,
 * so reading it before the compare-and-set is not a time-of-check problem —
 * there is no window in which it can change.
 */
export async function getMessageAuthors(
  orgId: string,
  ids: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!isAdminConfigured() || !orgId || !ids.length) return out;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("messages")
      .select("id, created_by")
      .eq("org_id", orgId)
      .in("id", ids.slice(0, 200));
    for (const r of ((data ?? []) as Row[])) {
      out.set(s(r.id), r.created_by ? s(r.created_by) : null);
    }
    return out;
  } catch {
    // An empty map means nothing is authorised — the caller treats an unknown
    // author as "not yours", which is the safe direction.
    return new Map();
  }
}

/**
 * Approve a proposed message. CAS on `needs_approval`, so two approvers racing
 * produce one approval and one honest "someone got there first" — and an
 * already-sent message can never be approved a second time.
 */
export async function approveMessage(input: {
  id: string;
  orgId: string;
  approverId: string;
}): Promise<MessageRow | null> {
  if (!isAdminConfigured()) return null;
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data } = await admin
      .from("messages")
      .update({
        status: "approved",
        approved_by: input.approverId,
        approved_at: now,
        next_attempt_at: now,
        updated_at: now,
      })
      .eq("id", input.id)
      .eq("org_id", input.orgId)
      .eq("status", "needs_approval")
      .select("*")
      .maybeSingle();
    return data ? mapMessage(data as Row) : null;
  } catch {
    return null;
  }
}

/** Reject a proposal. Same CAS discipline; rejection is final. */
export async function rejectMessage(input: {
  id: string;
  orgId: string;
  actorId: string;
  reason?: string;
}): Promise<MessageRow | null> {
  if (!isAdminConfigured()) return null;
  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();
    const { data } = await admin
      .from("messages")
      .update({
        status: "rejected",
        rejected_by: input.actorId,
        rejected_at: now,
        reject_reason: (input.reason ?? "").slice(0, 300) || null,
        next_attempt_at: null,
        updated_at: now,
      })
      .eq("id", input.id)
      .eq("org_id", input.orgId)
      .eq("status", "needs_approval")
      .select("*")
      .maybeSingle();
    return data ? mapMessage(data as Row) : null;
  } catch {
    return null;
  }
}

/**
 * Cancel every queued or approved message to a number, right now.
 *
 * Called synchronously by the STOP webhook. This is the ONLY mechanism that
 * catches a message already approved and waiting for the drain — stop rules run
 * on the next tick and the send-time re-gate runs at the drain, both of which
 * are too late if the drain fires first.
 */
export async function cancelPendingMessagesForPhone(input: {
  orgId: string;
  phone: string;
  reason: string;
}): Promise<number> {
  const digits = dncKey(input.phone);
  if (!isAdminConfigured() || !input.orgId || !digits) return 0;
  try {
    const admin = createAdminClient();
    const { data: threads, error: threadsErr } = await admin
      .from("message_threads")
      .select("id")
      .eq("org_id", input.orgId)
      .eq("contact_digits", digits);
    // Returning 0 here made "the read failed" identical to "they had nothing
    // pending" — so an inbound STOP could leave already-approved messages
    // sitting in the queue and the drain would send them. The caller wraps
    // this, so a throw is caught and, unlike a 0, is distinguishable.
    if (threadsErr) {
      throw new Error("Could not read this contact's threads to cancel pending messages");
    }
    const ids = ((threads ?? []) as Row[]).map((t) => s(t.id));
    if (!ids.length) return 0;
    const { data, error: cancelErr } = await admin
      .from("messages")
      .update({
        status: "canceled",
        reject_reason: input.reason,
        next_attempt_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", input.orgId)
      .in("thread_id", ids)
      .in("status", ["draft", "needs_approval", "approved", "queued"])
      .select("id");
    // Same reasoning as the read above: a failed cancel that reports 0 is a
    // STOP the product believes it honoured and did not.
    if (cancelErr) {
      throw new Error("Could not cancel this contact's pending messages");
    }
    return (data ?? []).length;
  } catch {
    return 0;
  }
}

export interface ApprovalRow extends MessageRow {
  leadName: string;
  authorName: string;
}

/**
 * The approvals inbox: what is waiting for a human, oldest first.
 *
 * `authorId` fences the list to one person's own drafts. It is passed for
 * anyone who cannot approve what the automation proposed — otherwise the
 * Approvals tab handed a rep the whole org's pending messages, complete with
 * lead name, phone number and full body, for records the pipeline board
 * directly beside it deliberately fences them out of. Two panels on one page
 * disagreeing about who may see whom is not a defensible scope.
 */
export async function listPendingApprovals(
  orgId: string | null,
  opts: { authorId?: string | null; limit?: number } = {},
): Promise<{ rows: ApprovalRow[]; total: number }> {
  if (!isAdminConfigured() || !orgId) return { rows: [], total: 0 };
  const limit = opts.limit ?? 50;
  try {
    const admin = createAdminClient();
    let listQ = admin
      .from("messages")
      .select("*")
      .eq("org_id", orgId)
      .eq("status", "needs_approval");
    let countQ = admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "needs_approval");
    if (opts.authorId) {
      listQ = listQ.eq("created_by", opts.authorId);
      countQ = countQ.eq("created_by", opts.authorId);
    }
    const [listRes, countRes] = await Promise.all([
      listQ.order("created_at", { ascending: true }).limit(limit),
      countQ,
    ]);
    const rows = ((listRes.data ?? []) as Row[]).map(mapMessage);
    const leadIds = [...new Set(rows.map((r) => r.leadId).filter(Boolean))] as string[];
    const authorIds = [...new Set(rows.map((r) => r.createdBy).filter(Boolean))] as string[];
    const [leadsRes, membersRes] = await Promise.all([
      leadIds.length
        ? admin.from("leads").select("id, first_name, last_name").in("id", leadIds)
        : Promise.resolve({ data: [] as Row[] }),
      authorIds.length
        ? admin
            .from("organization_members")
            .select("user_id, name")
            .eq("org_id", orgId)
            .in("user_id", authorIds)
        : Promise.resolve({ data: [] as Row[] }),
    ]);
    const names = new Map(
      ((leadsRes.data ?? []) as Row[]).map((l) => [
        s(l.id),
        [s(l.first_name), s(l.last_name)].filter(Boolean).join(" "),
      ]),
    );
    const authors = new Map(
      ((membersRes.data ?? []) as Row[]).map((m) => [s(m.user_id), s(m.name)]),
    );
    return {
      total: countRes.count ?? rows.length,
      rows: rows.map((r) => ({
        ...r,
        leadName: (r.leadId ? names.get(r.leadId) : "") || "—",
        // The automation is the author when nobody is.
        authorName: (r.createdBy ? authors.get(r.createdBy) : "") || "Automation",
      })),
    };
  } catch {
    return { rows: [], total: 0 };
  }
}

/** The conversation with one person, newest last (reading order). */
export async function getThreadMessages(input: {
  orgId: string;
  leadId: string;
  limit?: number;
}): Promise<MessageRow[]> {
  if (!isAdminConfigured() || !input.orgId) return [];
  try {
    const admin = createAdminClient();
    const { data: thread } = await admin
      .from("message_threads")
      .select("id")
      .eq("org_id", input.orgId)
      .eq("lead_id", input.leadId)
      .maybeSingle();
    if (!thread) return [];
    const { data } = await admin
      .from("messages")
      .select("*")
      .eq("thread_id", s(thread.id))
      .order("created_at", { ascending: false })
      .limit(input.limit ?? 50);
    return ((data ?? []) as Row[]).map(mapMessage).reverse();
  } catch {
    return [];
  }
}

/** Scrub a batch of numbers against the org's suppression list in one read. */
export async function dncDigitsFor(orgId: string): Promise<Set<string>> {
  return getDncDigits(orgId);
}

export interface InboundMatch {
  leadId: string | null;
  opportunityId: string | null;
  /** True when more than one record carries this number. */
  ambiguous: boolean;
  candidates: number;
}

/**
 * Which record did this text come from?
 *
 * The book genuinely contains duplicates of the same human, so ambiguity is the
 * normal case, not an edge one. It resolves DETERMINISTICALLY — an open
 * opportunity first, then the most recently contacted, then the newest, then
 * the lowest id — and flags itself so a human can correct it.
 *
 * It NEVER fans out to all matches. Attaching one inbound message to four lead
 * records would multiply the conversation and let four reps each answer the
 * same person believing they were the only one.
 *
 * Zero matches is not a failure either: the thread is still created with a null
 * lead so the message is never dropped, and it surfaces as unmatched.
 */
export async function resolveLeadForInbound(
  orgId: string,
  phone: string,
): Promise<InboundMatch> {
  const digits = dncKey(phone);
  const empty: InboundMatch = {
    leadId: null,
    opportunityId: null,
    ambiguous: false,
    candidates: 0,
  };
  if (!isAdminConfigured() || !orgId || !digits) return empty;
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("leads")
      .select("id, phone, last_attempt_at, created_at")
      .eq("org_id", orgId)
      .is("archived_at", null)
      .ilike("phone", `%${digits}%`)
      .limit(50);
    // The ilike is a coarse prefilter; the exact last-ten comparison is what
    // stops a different person whose number merely contains these digits.
    const matches = ((data ?? []) as Row[]).filter(
      (l) => dncKey(s(l.phone)) === digits,
    );
    if (!matches.length) return empty;

    let chosen = matches[0];
    if (matches.length > 1) {
      const ids = matches.map((l) => s(l.id));
      const { data: opps } = await admin
        .from("opportunities")
        .select("id, lead_id")
        .eq("org_id", orgId)
        .in("lead_id", ids)
        .neq("op_status", "closed");
      const openByLead = new Map(
        ((opps ?? []) as Row[]).map((o) => [s(o.lead_id), s(o.id)]),
      );
      const sorted = [...matches].sort((a, b) => {
        const aOpen = openByLead.has(s(a.id)) ? 1 : 0;
        const bOpen = openByLead.has(s(b.id)) ? 1 : 0;
        if (aOpen !== bOpen) return bOpen - aOpen;
        const aTouch = Date.parse(s(a.last_attempt_at)) || 0;
        const bTouch = Date.parse(s(b.last_attempt_at)) || 0;
        if (aTouch !== bTouch) return bTouch - aTouch;
        const aNew = Date.parse(s(a.created_at)) || 0;
        const bNew = Date.parse(s(b.created_at)) || 0;
        if (aNew !== bNew) return bNew - aNew;
        return s(a.id) < s(b.id) ? -1 : 1;
      });
      chosen = sorted[0];
      const leadId = s(chosen.id);
      return {
        leadId,
        opportunityId: openByLead.get(leadId) ?? null,
        ambiguous: true,
        candidates: matches.length,
      };
    }

    const leadId = s(chosen.id);
    const { data: opp } = await admin
      .from("opportunities")
      .select("id")
      .eq("org_id", orgId)
      .eq("lead_id", leadId)
      .neq("op_status", "closed")
      .maybeSingle();
    return {
      leadId,
      opportunityId: opp ? s(opp.id) : null,
      ambiguous: false,
      candidates: 1,
    };
  } catch {
    return empty;
  }
}

/**
 * Persist an inbound message.
 *
 * STOP bodies are stored like any other. The customer's own words ARE the
 * evidence of the opt-out, and discarding them because the keyword was handled
 * elsewhere would throw away the only record of what they actually said.
 *
 * Deduped on provider_sid, which is globally unique — Twilio retries inbound
 * webhooks, and a retry must not create a second copy of one message.
 */
export async function recordInboundMessage(input: {
  orgId: string;
  threadId: string;
  leadId: string | null;
  opportunityId: string | null;
  fromNumber: string;
  toNumber: string;
  body: string;
  providerSid: string | null;
}): Promise<boolean> {
  if (!isAdminConfigured() || !input.orgId) return false;
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("messages").insert({
      org_id: input.orgId,
      thread_id: input.threadId,
      lead_id: input.leadId,
      opportunity_id: input.opportunityId,
      direction: "inbound",
      channel: "sms",
      status: "received",
      body: input.body,
      from_number: input.fromNumber,
      to_number: input.toNumber,
      provider_sid: input.providerSid,
      segments: countSegments(input.body),
    });
    // 23505 on provider_sid is the expected replay path — silence is correct.
    if (error) return false;
    const now = new Date().toISOString();
    await admin
      .from("message_threads")
      .update({ last_inbound_at: now, updated_at: now })
      .eq("id", input.threadId);
    return true;
  } catch {
    count("messaging.inbound_fail", 1, { orgId: input.orgId });
    return false;
  }
}

/**
 * Has this person replied since `since`?
 *
 * The `replied` stop rule reads this. Kept here rather than in the engine so
 * the engine imports nothing from the messaging layer — an architecture test
 * enforces that separation, because the engine must not be able to send.
 */
export async function hasInboundSince(input: {
  orgId: string;
  leadId: string;
  since: string;
}): Promise<boolean> {
  if (!isAdminConfigured() || !input.orgId) return false;
  try {
    const admin = createAdminClient();
    const { count: c } = await admin
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("org_id", input.orgId)
      .eq("lead_id", input.leadId)
      .eq("direction", "inbound")
      .gte("created_at", input.since);
    return (c ?? 0) > 0;
  } catch {
    return false;
  }
}
