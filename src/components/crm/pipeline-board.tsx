"use client";

import {
  AlertTriangle,
  Droplets,
  ExternalLink,
  KanbanSquare,
  Loader2,
  MoreHorizontal,
  PhoneCall,
  PhoneOff,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Menu, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { useLead360 } from "@/components/leads/lead-360/lead-360-provider";
import { dialDeepLink } from "@/lib/dialer/deep-link";
import type { BoardCard, BoardLaneData, CrmBoard } from "@/lib/db/crm";
import {
  BOARD_LANES,
  CLOSE_REASONS,
  laneCopy,
  laneEntryStage,
  laneForStage,
  legalDropLanes,
  type BoardLane,
} from "@/lib/opportunities/board";
import type { OpportunityStage } from "@/lib/opportunities/stage-machine";
import { STAGE_LABELS } from "@/lib/opportunities/why-now";
import { cn, formatPhone, relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The pipeline board.
//
// Drag is an ENHANCEMENT, never the only way. Every move is also available from
// the card's menu, because drag-and-drop is unusable with a keyboard, awkward
// on touch, and impossible with a screen reader — and this is the only surface
// in the product that can correct a mis-staged record.
//
// The legal moves come from `canTransition`, not from the layout: a rep is not
// offered "Won" at all, rather than being offered it and refused afterwards.
// The server re-checks the same rule regardless.
// ─────────────────────────────────────────────────────────────────────────────

export function PipelineBoard({
  board,
  canManage,
  ownerName,
  appointmentNoun,
  leadNoun,
  leadNounPlural,
}: {
  board: CrmBoard | null;
  canManage: boolean;
  /** Whose pipeline this is, when narrowed to one owner. */
  ownerName: string | null;
  appointmentNoun: string;
  leadNoun: string;
  leadNounPlural: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dragging, setDragging] = useState<BoardCard | null>(null);

  if (!board) {
    return (
      <EmptyState
        icon={KanbanSquare}
        title="The pipeline isn't available right now"
        description="The board couldn't be read. Reload the page; if it keeps happening, the workspace database may be unreachable."
      />
    );
  }

  const actor = canManage ? "manager" : "rep";
  // A total that silently omits a lane it could not read would be short by a
  // whole population while looking authoritative. If any lane is unknown, so
  // is the total.
  const anyLaneUnknown = board.lanes.some((l) => l.count == null);
  const total = anyLaneUnknown
    ? null
    : board.lanes.reduce((sum, l) => sum + (l.count ?? 0), 0);

  async function move(card: BoardCard, to: OpportunityStage, allowRegress: boolean) {
    setBusyId(card.id);
    try {
      const res = await fetch("/api/crm/stage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          opportunityId: card.id,
          from: card.stage,
          to,
          allowRegress,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        suppressed?: boolean;
      };
      if (!res.ok) {
        toast({ title: j.error ?? "That move didn't go through.", tone: "danger" });
        // A 409 means the board is stale — re-read so the card snaps to where
        // the record actually is rather than where this page still thinks.
        if (res.status === 409) router.refresh();
        return;
      }
      toast({
        title: `${card.leadName} → ${STAGE_LABELS[to] ?? to}`,
        description: j.suppressed
          ? "Also added to the Do-Not-Call list, so nothing dials them again."
          : undefined,
        tone: "success",
      });
      router.refresh();
    } catch {
      toast({ title: "That move didn't go through.", tone: "danger" });
    } finally {
      setBusyId(null);
    }
  }

  function onDropLane(lane: BoardLane) {
    const card = dragging;
    setDragging(null);
    if (!card) return;
    const to = laneEntryStage(lane);
    // Closed has six meanings; a drop can't pick one, so it stays a menu
    // decision. Say that rather than silently doing nothing.
    if (!to) {
      toast({
        title: "Pick a reason to close",
        description: "Use the card's menu — closing records why, and “Lost” is not a guess.",
      });
      return;
    }
    const backwards = !legalDropLanes(card.stage, actor).includes(lane);
    void move(card, to, backwards);
  }

  return (
    <div className="space-y-3">
      {/* Scope and window, stated. The same lane shows a supervisor and a rep
          two different totals, so the surface has to say which one this is. */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge tone="neutral">
          {ownerName ?? (board.scope === "org" ? "Whole org" : "Your book")} ·{" "}
          {total == null ? "—" : total.toLocaleString()} {leadNounPlural}
        </Badge>
        <span>Archived {leadNounPlural} excluded.</span>
        {board.leakCount != null && board.leakCount > 0 && (
          <Badge tone="warning" className="gap-1">
            <Droplets className="h-3 w-3" /> {board.leakCount} stalled
          </Badge>
        )}
        {board.degraded && (
          <Badge tone="danger" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Some lanes failed to load
          </Badge>
        )}
      </div>

      <div className="-mx-1 overflow-x-auto px-1 pb-2">
        <div className="flex min-w-max gap-3">
          {board.lanes.map((lane) => (
            <Lane
              key={lane.lane}
              data={lane}
              appointmentNoun={appointmentNoun}
              leadNoun={leadNoun}
              actor={actor}
              canManage={canManage}
              busyId={busyId}
              dragging={dragging}
              onDragStart={setDragging}
              onDragEnd={() => setDragging(null)}
              onDrop={onDropLane}
              onMove={move}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Lane({
  data,
  appointmentNoun,
  leadNoun,
  actor,
  canManage,
  busyId,
  dragging,
  onDragStart,
  onDragEnd,
  onDrop,
  onMove,
}: {
  data: BoardLaneData;
  appointmentNoun: string;
  leadNoun: string;
  actor: "rep" | "manager";
  canManage: boolean;
  busyId: string | null;
  dragging: BoardCard | null;
  onDragStart: (card: BoardCard) => void;
  onDragEnd: () => void;
  onDrop: (lane: BoardLane) => void;
  onMove: (card: BoardCard, to: OpportunityStage, allowRegress: boolean) => void;
}) {
  const copy = laneCopy(data.lane, appointmentNoun);
  // Highlight only lanes this particular card may legally enter.
  const droppable =
    canManage &&
    dragging != null &&
    legalDropLanes(dragging.stage, actor, { allowRegress: true }).includes(data.lane);

  return (
    <section
      aria-label={copy.label}
      onDragOver={(e) => {
        if (!droppable) return;
        e.preventDefault();
      }}
      onDrop={(e) => {
        if (!droppable) return;
        e.preventDefault();
        onDrop(data.lane);
      }}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-2xl border border-border/70 bg-surface-muted/40 p-2.5 transition-colors",
        droppable && "border-primary/50 bg-primary-soft/30",
      )}
    >
      <header className="mb-2 px-0.5">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-bold">{copy.label}</h3>
          <span className="text-sm font-bold tabular text-muted-foreground">
            {data.count == null ? "—" : data.count.toLocaleString()}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{copy.blurb}</p>
        {data.oldestEnteredAt && (
          // An exact "oldest here", not a median — see BoardLaneData.
          <p className="mt-1 text-xs text-muted-foreground">
            Oldest {relativeTime(data.oldestEnteredAt)}
          </p>
        )}
      </header>

      {data.failed ? (
        // NOT the empty state. "Nothing won yet in this view" is an assertion
        // of fact, and asserting it over a lane we could not read is exactly
        // the lie the "never render 0 for an unknown" rule exists to stop.
        <p className="flex items-start gap-1.5 px-0.5 py-2 text-xs text-danger">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          This lane couldn&apos;t be read, so what&apos;s in it is unknown.
        </p>
      ) : data.cards.length === 0 ? (
        // Collapses to one line rather than reserving a populated lane's height.
        <p className="px-0.5 py-2 text-xs text-muted-foreground">{copy.empty}</p>
      ) : (
        <ul className="space-y-2">
          {data.cards.map((card) => (
            <li key={card.id}>
              <Card
                card={card}
                leadNoun={leadNoun}
                appointmentNoun={appointmentNoun}
                actor={actor}
                canManage={canManage}
                busy={busyId === card.id}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onMove={onMove}
              />
            </li>
          ))}
          {data.count != null && data.count > data.cards.length && (
            <li className="px-0.5 pt-1 text-xs text-muted-foreground">
              Showing the {data.cards.length} longest here of {data.count.toLocaleString()}.
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function Card({
  card,
  leadNoun,
  appointmentNoun,
  actor,
  canManage,
  busy,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: BoardCard;
  leadNoun: string;
  appointmentNoun: string;
  actor: "rep" | "manager";
  canManage: boolean;
  busy: boolean;
  onDragStart: (card: BoardCard) => void;
  onDragEnd: () => void;
  onMove: (card: BoardCard, to: OpportunityStage, allowRegress: boolean) => void;
}) {
  const lead360 = useLead360();
  const here = laneForStage(card.stage);
  const forward = legalDropLanes(card.stage, actor);
  const withRegress = legalDropLanes(card.stage, actor, { allowRegress: true });

  return (
    <div
      draggable={canManage && !busy}
      onDragStart={() => onDragStart(card)}
      onDragEnd={onDragEnd}
      className={cn(
        "rounded-xl border border-border/70 bg-card p-2.5 shadow-soft transition-shadow",
        canManage && "hover:shadow-lift",
        busy && "opacity-60",
      )}
    >
      <div className="flex items-start gap-1.5">
        <button
          type="button"
          onClick={() => card.leadId && lead360.open(card.leadId)}
          disabled={!card.leadId}
          title={card.leadId ? undefined : "This record has no linked contact."}
          className="min-w-0 flex-1 text-left text-sm font-semibold hover:text-primary disabled:cursor-not-allowed disabled:hover:text-foreground"
        >
          <span className="block truncate">{card.leadName}</span>
        </button>
        {busy ? (
          <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <Menu>
            <MenuTrigger
              label={`Actions for ${card.leadName}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </MenuTrigger>

            <MenuItem
              icon={ExternalLink}
              disabled={!card.leadId}
              title={card.leadId ? undefined : "This record has no linked contact."}
              onSelect={() => card.leadId && lead360.open(card.leadId)}
            >
              Open record
            </MenuItem>
            <MenuItem
              icon={PhoneCall}
              disabled={!card.phone || card.dnc}
              title={
                card.dnc
                  ? "This number is on the Do-Not-Call list."
                  : !card.phone
                    ? "No phone number on this record."
                    : undefined
              }
              onSelect={() => {
                if (!card.phone || card.dnc) return;
                window.location.href = dialDeepLink({
                  phone: card.phone,
                  name: card.leadName,
                });
              }}
            >
              Call
            </MenuItem>

            {canManage && <MenuSeparator />}
            {canManage &&
              BOARD_LANES.filter(
                (l) => l !== here && l !== "closed" && withRegress.includes(l),
              ).map((l) => {
                const to = laneEntryStage(l);
                if (!to) return null;
                const backwards = !forward.includes(l);
                return (
                  <MenuItem
                    key={l}
                    onSelect={() => onMove(card, to, backwards)}
                    title={
                      backwards
                        ? "Moves this record backwards — recorded as a deliberate correction."
                        : undefined
                    }
                  >
                    {backwards ? "Move back to " : "Move to "}
                    {laneCopy(l, appointmentNoun).label}
                  </MenuItem>
                );
              })}

            {/* Destructive choices sit behind a separator, never adjacent to a
                constructive one — a mis-click here writes an append-only fact. */}
            {canManage && here !== "closed" && <MenuSeparator />}
            {canManage &&
              here !== "closed" &&
              CLOSE_REASONS.filter((r) => withRegress.includes("closed")).map((r) => (
                <MenuItem
                  key={r.stage}
                  danger
                  title={r.hint}
                  onSelect={() => onMove(card, r.stage, false)}
                >
                  Close · {r.label}
                </MenuItem>
              ))}
          </Menu>
        )}
      </div>

      {card.phone && (
        <p className="mt-0.5 truncate text-xs tabular text-muted-foreground">
          {formatPhone(card.phone)}
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <Badge tone="neutral">{STAGE_LABELS[card.stage] ?? card.stage}</Badge>
        {card.dnc && (
          // The lead is suppressed but the record is not. Real inconsistency —
          // shown where a rep would otherwise pick up the phone.
          <Badge tone="danger" className="gap-1">
            <PhoneOff className="h-3 w-3" /> Do not contact
          </Badge>
        )}
        {card.leaking && (
          <Badge tone="warning" className="gap-1">
            <Droplets className="h-3 w-3" /> Stalled
          </Badge>
        )}
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">
        {whyLine(card, leadNoun)}
      </p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{card.ownerName}</p>
    </div>
  );
}

/**
 * One line saying why this card is where it is. Deliberately not `whyNowLine`:
 * that answers "should I call this person now" from work items and signals the
 * board doesn't load. This answers "what is this record doing in this lane",
 * which is the board's question.
 */
function whyLine(card: BoardCard, leadNoun: string): string {
  if (card.attemptCount === 0) {
    return card.stageEnteredAt
      ? `A new ${leadNoun}, waiting since ${relativeTime(card.stageEnteredAt)}.`
      : `A new ${leadNoun}, never attempted.`;
  }
  const attempts = `${card.attemptCount} attempt${card.attemptCount === 1 ? "" : "s"}`;
  if (card.lastTouchedAt) return `${attempts} · last worked ${relativeTime(card.lastTouchedAt)}.`;
  if (card.stageEnteredAt) return `${attempts} · here since ${relativeTime(card.stageEnteredAt)}.`;
  return attempts;
}
