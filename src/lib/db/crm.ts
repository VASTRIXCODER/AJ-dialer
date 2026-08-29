import "server-only";

import {
  BOARD_LANES,
  LANE_STAGES,
  UNASSIGNED,
  type BoardLane,
} from "../opportunities/board";
import type { OpportunityStage } from "../opportunities/stage-machine";
import { createAdminClient, isAdminConfigured } from "../supabase/admin";
import type { Scope } from "./scope";

// ─────────────────────────────────────────────────────────────────────────────
// The CRM workspace's reads.
//
// Two rules this module exists to keep, both from the metric-honesty spec:
//
//   • Every count is an exact `head: true, count: "exact"` — never an array
//     length. PostgREST caps a response at 1,000 rows, so `rows.length` on a
//     lane holding 34,000 records would confidently render "1000".
//
//   • Every number states its scope. A supervisor sees the whole org and a rep
//     sees their own book, so the SAME lane shows two different totals to two
//     people standing next to each other. The scope travels with the data
//     (`CrmBoard.scope`) so the surface can say which one it is showing.
//
// Reads only. Every write goes through an API route that re-checks permission.
// ─────────────────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => Number(v ?? 0) || 0;

/** Cards rendered per lane. The board is a triage surface, not a data dump. */
const CARDS_PER_LANE = 8;
/** Bound on the claimable-work page. */
const QUEUE_LIMIT = 50;

export type CrmScope = "org" | "own";

export interface BoardCard {
  id: string;
  leadId: string | null;
  leadName: string;
  phone: string;
  stage: OpportunityStage;
  ownerName: string;
  ownerId: string | null;
  stageEnteredAt: string | null;
  lastTouchedAt: string | null;
  attemptCount: number;
  nextActionKind: string | null;
  nextActionDueAt: string | null;
  /** In app_pipeline_leaks: worked once, then stalled with nothing holding it. */
  leaking: boolean;
  /**
   * The lead is on the Do-Not-Call list while its opportunity is NOT
   * suppressed. Shown rather than hidden: it is a real inconsistency, and a
   * card nobody may dial has to say so where the rep can see it.
   */
  dnc: boolean;
}

export interface BoardLaneData {
  lane: BoardLane;
  /** Exact — a head count, not the sample size. */
  count: number;
  cards: BoardCard[];
  /**
   * When the sample was ordered longest-in-stage first, the age of the oldest
   * record in the lane. Deliberately NOT a median: computing one honestly needs
   * an unbiased sample this query does not take, and a median drawn from an
   * oldest-first page would read low and mean nothing. An exact "oldest here"
   * is both true and the number a supervisor would act on.
   */
  oldestEnteredAt: string | null;
}

export interface CrmBoard {
  lanes: BoardLaneData[];
  scope: CrmScope;
  /**
   * The owner the board was narrowed to, when a supervisor picked one:
   * a user id, the literal "unassigned", or null for everyone. Every count on
   * the board is computed under this filter, so the surface must name it — a
   * lane reading 12 means something different depending on whose 12 it is.
   */
  ownerFilter: string | null;
  /** Leaking opportunities in scope — exact, and the board's one headline. */
  leakCount: number;
  /** A lane whose read failed. The surface says so instead of showing zero. */
  degraded: boolean;
}

export interface QueueItem {
  id: string;
  leadId: string | null;
  leadName: string;
  phone: string;
  type: string;
  reason: string;
  queue: string | null;
  priority: number;
  dueAt: string | null;
  /** Held until this instant; null when free. */
  reservedUntil: string | null;
  reservedByMe: boolean;
}

export interface CrmQueue {
  items: QueueItem[];
  /** Exact count of everything claimable in scope, not just this page. */
  claimable: number;
  /** Mine right now: reserved by me and still inside the lease. */
  held: number;
}

/** Ordering key per lane: what "needs attention first" means there. */
function laneOrder(lane: BoardLane): { column: string; ascending: boolean } {
  // Open lanes surface the most-stuck record first — finding what stopped
  // moving is the whole point of a board. Won and Closed are history, so they
  // read newest-first like every other archive in the product.
  return lane === "won" || lane === "closed"
    ? { column: "stage_entered_at", ascending: false }
    : { column: "stage_entered_at", ascending: true };
}

const CARD_COLUMNS =
  "id, lead_id, stage, owner_id, stage_entered_at, last_touched_at, attempt_count, next_action_kind, next_action_due_at";

/**
 * The pipeline board: one exact count and one small ordered page per lane, with
 * the leak set overlaid on exactly the cards that got sampled.
 */
export async function getCrmBoard(
  scope: Scope,
  opts?: { ownerId?: string | null },
): Promise<CrmBoard | null> {
  if (!isAdminConfigured() || !scope.orgId) return null;
  const orgId = scope.orgId;
  // A rep's board is their own book. Unowned records are nobody's card — they
  // reach a rep through the shared queue, which is what the queue is for.
  const crmScope: CrmScope = scope.supervisor ? "org" : "own";
  // A rep's fence is not negotiable: an `?owner=` in the URL can only ever
  // narrow a supervisor's view, never widen a rep's past their own book.
  const ownerFilter = crmScope === "own" ? null : (opts?.ownerId || null);
  const mine = crmScope === "own" ? scope.userId : null;
  const admin = createAdminClient();

  // Whichever ownership fence is in force, as the two facts a query needs.
  // Deliberately NOT a generic `applyFence(query)` helper: PostgREST's builder
  // type is recursive enough that threading it through one blows the compiler's
  // instantiation depth. Three four-line conditionals type cleanly and read
  // fine; the abstraction cost more than it saved.
  const fenceCol = "owner_id";
  const fenceEq = mine ?? (ownerFilter && ownerFilter !== UNASSIGNED ? ownerFilter : null);
  const fenceNull = !mine && ownerFilter === UNASSIGNED;

  try {
    const perLane = await Promise.all(
      BOARD_LANES.map(async (lane) => {
        const stages = [...LANE_STAGES[lane]];
        const order = laneOrder(lane);

        let countQ = admin
          .from("opportunities")
          .select("id, leads!inner(id)", { count: "exact", head: true })
          .eq("org_id", orgId)
          .in("stage", stages)
          .is("leads.archived_at", null);
        if (fenceEq) countQ = countQ.eq(fenceCol, fenceEq);
        else if (fenceNull) countQ = countQ.is(fenceCol, null);

        let cardQ = admin
          .from("opportunities")
          .select(`${CARD_COLUMNS}, leads!inner(id, first_name, last_name, phone, status)`)
          .eq("org_id", orgId)
          .in("stage", stages)
          .is("leads.archived_at", null);
        if (fenceEq) cardQ = cardQ.eq(fenceCol, fenceEq);
        else if (fenceNull) cardQ = cardQ.is(fenceCol, null);

        const [countRes, cardRes] = await Promise.all([
          countQ,
          cardQ
            .order(order.column, { ascending: order.ascending, nullsFirst: false })
            .limit(CARDS_PER_LANE),
        ]);
        return { lane, countRes, cardRes };
      }),
    );

    let degraded = false;
    const rawLanes = perLane.map(({ lane, countRes, cardRes }) => {
      if (countRes.error || cardRes.error) degraded = true;
      return { lane, count: countRes.count ?? 0, rows: (cardRes.data ?? []) as Row[] };
    });

    const cardIds = rawLanes.flatMap((l) => l.rows.map((r) => s(r.id)));

    // Leaks: an exact scoped count for the headline, and membership tested
    // against exactly the ids on screen. Flagging from a 1,000-row page of an
    // org-wide leak list would silently miss cards past the cap.
    let leakCountQ = admin
      .rpc("app_pipeline_leaks", { p_org: orgId }, { count: "exact", head: true })
      .gt("attempt_count", 0);
    if (fenceEq) leakCountQ = leakCountQ.eq(fenceCol, fenceEq);
    else if (fenceNull) leakCountQ = leakCountQ.is(fenceCol, null);

    const leakFlagQ = cardIds.length
      ? admin
          .rpc("app_pipeline_leaks", { p_org: orgId })
          .select("id")
          .gt("attempt_count", 0)
          .in("id", cardIds)
      : null;

    const ownerIds = [
      ...new Set(rawLanes.flatMap((l) => l.rows.map((r) => s(r.owner_id)).filter(Boolean))),
    ];
    const memberQ = ownerIds.length
      ? admin
          .from("organization_members")
          .select("user_id, name")
          .eq("org_id", orgId)
          .in("user_id", ownerIds)
      : null;

    const [leakCountRes, leakFlagRes, memberRes] = await Promise.all([
      leakCountQ,
      leakFlagQ ?? Promise.resolve({ data: [] as Row[] }),
      memberQ ?? Promise.resolve({ data: [] as Row[] }),
    ]);

    const leakIds = new Set(((leakFlagRes.data ?? []) as Row[]).map((r) => s(r.id)));
    const ownerNames = new Map<string, string>();
    for (const m of ((memberRes.data ?? []) as Row[])) {
      ownerNames.set(s(m.user_id), s(m.name));
    }

    const lanes: BoardLaneData[] = rawLanes.map(({ lane, count, rows }) => {
      const cards = rows.map((r): BoardCard => {
        // PostgREST returns an embedded to-one as an object, but some shapes
        // return a single-element array. Handle both, or every name on the
        // board renders as a dash.
        const rawLead = (r as { leads?: Row | Row[] }).leads;
        const lead = (Array.isArray(rawLead) ? rawLead[0] : rawLead) ?? {};
        const name = [s(lead.first_name), s(lead.last_name)].filter(Boolean).join(" ");
        const stage = s(r.stage) as OpportunityStage;
        return {
          id: s(r.id),
          leadId: r.lead_id ? s(r.lead_id) : null,
          leadName: name || "—",
          phone: s(lead.phone),
          stage,
          ownerId: r.owner_id ? s(r.owner_id) : null,
          ownerName: ownerNames.get(s(r.owner_id)) || "Unassigned",
          stageEnteredAt: r.stage_entered_at ? s(r.stage_entered_at) : null,
          lastTouchedAt: r.last_touched_at ? s(r.last_touched_at) : null,
          attemptCount: n(r.attempt_count),
          nextActionKind: r.next_action_kind ? s(r.next_action_kind) : null,
          nextActionDueAt: r.next_action_due_at ? s(r.next_action_due_at) : null,
          leaking: leakIds.has(s(r.id)),
          dnc: s(lead.status) === "dnc" && stage !== "dnc_suppressed",
        };
      });
      return {
        lane,
        count,
        cards,
        // Only meaningful when the page really is oldest-first.
        oldestEnteredAt: laneOrder(lane).ascending ? (cards[0]?.stageEnteredAt ?? null) : null,
      };
    });

    return {
      lanes,
      scope: crmScope,
      ownerFilter,
      leakCount: leakCountRes.count ?? 0,
      degraded,
    };
  } catch {
    return null;
  }
}

/**
 * The shared queue: work nobody is holding right now. This is the piece neither
 * /today nor /command can do — /today is fenced to what is already yours,
 * /command is read-only. Claiming goes through the atomic RPC.
 */
export async function getCrmQueue(scope: Scope): Promise<CrmQueue | null> {
  if (!isAdminConfigured() || !scope.orgId) return null;
  const orgId = scope.orgId;
  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  // The SAME predicate app_claim_work_items uses. If this list showed anything
  // the RPC would refuse, "Claim 5" would take fewer than the five on screen
  // and read as broken.
  const liveStatus = `status.eq.pending,and(status.eq.reserved,reserved_until.lt.${nowIso})`;
  const dueNow = `due_at.is.null,due_at.lte.${nowIso}`;
  const claimableByMe = `owner_id.is.null,owner_id.eq.${scope.userId}`;

  try {
    const [countRes, rowsRes, heldRes] = await Promise.all([
      admin
        .from("work_items")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .or(liveStatus)
        .or(dueNow)
        .or(claimableByMe),
      admin
        .from("work_items")
        .select("id, lead_id, type, reason, queue, priority, due_at, reserved_until, reserved_by")
        .eq("org_id", orgId)
        .or(liveStatus)
        .or(dueNow)
        .or(claimableByMe)
        .order("priority", { ascending: false })
        .order("due_at", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .limit(QUEUE_LIMIT),
      admin
        .from("work_items")
        .select("id", { count: "exact", head: true })
        .eq("org_id", orgId)
        .eq("status", "reserved")
        .eq("reserved_by", scope.userId)
        .gt("reserved_until", nowIso),
    ]);

    const rows = (rowsRes.data ?? []) as Row[];
    const leadIds = [...new Set(rows.map((r) => s(r.lead_id)).filter(Boolean))];
    const leads = new Map<string, { name: string; phone: string }>();
    if (leadIds.length) {
      const { data } = await admin
        .from("leads")
        .select("id, first_name, last_name, phone")
        .in("id", leadIds);
      for (const l of (data ?? []) as Row[]) {
        leads.set(s(l.id), {
          name: [s(l.first_name), s(l.last_name)].filter(Boolean).join(" "),
          phone: s(l.phone),
        });
      }
    }

    return {
      claimable: countRes.count ?? 0,
      held: heldRes.count ?? 0,
      items: rows.map((r): QueueItem => {
        const lead = leads.get(s(r.lead_id));
        return {
          id: s(r.id),
          leadId: r.lead_id ? s(r.lead_id) : null,
          leadName: lead?.name || "—",
          phone: lead?.phone ?? "",
          type: s(r.type),
          reason: s(r.reason),
          queue: r.queue ? s(r.queue) : null,
          priority: n(r.priority),
          dueAt: r.due_at ? s(r.due_at) : null,
          reservedUntil: r.reserved_until ? s(r.reserved_until) : null,
          reservedByMe: s(r.reserved_by) === scope.userId,
        };
      }),
    };
  } catch {
    return null;
  }
}

// Display copy for work items lives in ../opportunities/event-copy — it is
// PURE, and the Queue that renders it is a Client Component. A label exported
// from here would be a value crossing the `server-only` boundary, which the
// type-checker permits and the bundler refuses.
