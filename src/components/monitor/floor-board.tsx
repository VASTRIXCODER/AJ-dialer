"use client";

import { MoreHorizontal, PhoneOff, Radio, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FloorCard,
  type FloorCapabilities,
  type FloorCardModel,
  listenDisabledReason,
} from "@/components/monitor/floor-card";
import { FloorDetailPanel } from "@/components/monitor/floor-detail-panel";
import {
  FLOOR_FILTER_DEFAULT,
  FloorFilters,
  type FloorFilterValue,
  type FloorView,
} from "@/components/monitor/floor-filters";
import { useLiveListen } from "@/components/monitor/use-live-listen";
import { Avatar } from "@/components/ui/avatar";
import { Card } from "@/components/ui/card";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useStoredDensity } from "@/components/ui/density-toggle";
import { Menu, MenuItem, MenuTrigger } from "@/components/ui/dropdown-menu";
import { StatusPill } from "@/components/ui/status-pill";
import type { CallStatePayload, PresencePayload } from "@/lib/realtime/events";
import { mergeFloor } from "@/lib/realtime/floor-merge";
import {
  applyCallState,
  callsFromSnapshot,
  type FloorCallMap,
  isStaleCall,
  reconcileWithSnapshot,
  type SnapshotAiCall,
  type SnapshotHumanCall,
} from "@/lib/realtime/floor-reducer";
import { useOrgChannel } from "@/lib/realtime/use-org-channel";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { cn, formatDuration, initials } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// FloorBoard — the Live Floor: one accurate, push-fed picture of every seat.
//
// Data flow: /api/floor/snapshot hydrates; `call.state` broadcasts move cards
// via the PURE reducer (no refetch per event — that's what the old 2s poll
// was); each snapshot poll (30s live / 5s fallback) reconciles the two, per
// call, by timestamp. Rep rows come from E1's mergeFloor — webhook truth beats
// the browser's claim, always.
// ─────────────────────────────────────────────────────────────────────────────

interface FloorSnapshot {
  humans: SnapshotHumanCall[];
  ai: SnapshotAiCall[];
  presenceFallback: {
    userId: string;
    name: string;
    status: PresencePayload["status"];
    statusSince: number;
  }[];
  roster: { userId: string; name: string }[];
  callsToday: Record<string, number>;
  totalCallsToday: number;
  capabilities: FloorCapabilities;
  generatedAt: string;
}

const NO_CAPS: FloorCapabilities = { humanListen: false, aiLiveAudio: false };

export function FloorBoard({
  orgId,
  canListen,
  canIntervene,
}: {
  orgId: string | null;
  canListen: boolean;
  canIntervene: boolean;
}) {
  const [snap, setSnap] = useState<FloorSnapshot | null>(null);
  const [calls, setCalls] = useState<FloorCallMap>(() => new Map());
  const [now, setNow] = useState(() => Date.now());
  const [filters, setFilters] = useState<FloorFilterValue>(FLOOR_FILTER_DEFAULT);
  const [view, setView] = useState<FloorView>("grid");
  const [density, setDensity] = useStoredDensity("floor:density");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [endBusyId, setEndBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  // View preference persists like density does.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("floor:view");
      if (stored === "grid" || stored === "list") setView(stored);
    } catch {
      /* best-effort */
    }
  }, []);
  const changeView = useCallback((v: FloorView) => {
    setView(v);
    try {
      window.localStorage.setItem("floor:view", v);
    } catch {
      /* best-effort */
    }
  }, []);

  const load = useCallback(() => {
    fetch("/api/floor/snapshot", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: FloorSnapshot | null) => {
        if (!j) return;
        setSnap(j);
        const snapAt = Date.parse(j.generatedAt) || Date.now();
        setCalls((prev) =>
          reconcileWithSnapshot(
            prev,
            callsFromSnapshot(j.humans ?? [], j.ai ?? [], snapAt),
            snapAt,
          ),
        );
      })
      .catch(() => {});
  }, []);

  // Push-fed: each call.state event moves ONE card through the pure reducer —
  // no refetch-per-event. (Re)subscribes refetch the snapshot to close gaps.
  const { health, presence } = useOrgChannel({
    orgId,
    on: {
      "call.state": (p: CallStatePayload) =>
        setCalls((prev) => applyCallState(prev, p, Date.now())),
    },
    onResync: load,
  });

  // The snapshot poll is a safety net when push is live, the engine otherwise.
  useVisiblePoll(load, health === "live" ? 30_000 : 5_000);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Listen (the existing conference/relay flow — see use-live-listen) ───────
  const listen = useLiveListen();
  const { listeningKey, stop: stopListen } = listen;
  // Stop audio the moment the call we're listening to leaves the board.
  useEffect(() => {
    if (listeningKey && !calls.has(listeningKey)) stopListen(false);
  }, [calls, listeningKey, stopListen]);

  const toggleListen = useCallback(
    (card: FloorCardModel) => {
      setActionError("");
      const target =
        card.mode === "ai" && card.conversationId
          ? ({ kind: "ai", conversationId: card.conversationId } as const)
          : card.humanId
            ? ({ kind: "human", humanId: card.humanId } as const)
            : null;
      if (!target) return;
      void listen.start(target);
    },
    [listen],
  );

  const endAiCall = useCallback(
    async (conversationId: string) => {
      setEndBusyId(conversationId);
      setActionError("");
      try {
        const res = await fetch("/api/elevenlabs/intervene", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ conversationId, action: "end" }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) setActionError(json.error ?? "Could not end the call.");
        else load();
      } catch {
        setActionError("Network error.");
      } finally {
        setEndBusyId(null);
      }
    },
    [load],
  );

  // ── Build the board (calls + idle seats) ────────────────────────────────────
  const capabilities = snap?.capabilities ?? NO_CAPS;
  const cards = useMemo<FloorCardModel[]>(() => {
    const roster = snap?.roster ?? [];
    const callsToday = snap?.callsToday ?? {};
    const nameById = new Map(roster.map((r) => [r.userId, r.name]));

    const list = [...calls.values()];
    const callCards: FloorCardModel[] = list.map((c) => ({
      key: c.key,
      kind: "call",
      mode: c.kind === "ai" ? "ai" : "manual",
      repUserId: c.ownerId,
      repName:
        c.repName || (c.ownerId ? (nameById.get(c.ownerId) ?? "") : ""),
      state: c.state,
      stateSince: c.stateSince,
      lastEventAt: c.lastEventAt,
      stale: isStaleCall(c, now),
      leadId: c.leadId,
      leadName: c.leadName,
      city: c.city,
      campaignName: c.campaignName,
      callsToday: c.ownerId ? (callsToday[c.ownerId] ?? 0) : 0,
      aiActiveCount: 0,
      humanId: c.kind === "human" ? c.id : undefined,
      conversationId: c.kind === "ai" ? c.id : undefined,
      canListenNow: c.canListen,
    }));

    // Rep seats — channel presence first, snapshot heartbeats as the fallback,
    // merged by E1's rule: a proven call always beats the claim.
    const claims = new Map<string, PresencePayload>();
    for (const p of snap?.presenceFallback ?? []) {
      claims.set(p.userId, {
        userId: p.userId,
        name: p.name || nameById.get(p.userId) || "",
        status: p.status,
        statusSince: p.statusSince,
      });
    }
    for (const [userId, p] of presence) claims.set(userId, p);

    const repRows = mergeFloor({
      presence: claims.values(),
      liveCalls: list
        .filter((c) => c.kind === "human")
        .map((c) => ({
          ownerId: c.ownerId,
          state: c.state,
          leadName: c.leadName,
          since: c.stateSince,
          at: c.lastEventAt,
        })),
      aiActive: list
        .filter((c) => c.kind === "ai")
        .map((c) => ({ ownerId: c.ownerId })),
      now,
      roster,
    });

    const CALL_DRIVEN = new Set(["connected", "dialing", "ai"]);
    const seatCards: FloorCardModel[] = repRows
      .filter((r) => !CALL_DRIVEN.has(r.status))
      .map((r) => ({
        key: `rep:${r.userId}`,
        kind: "rep",
        mode: null,
        repUserId: r.userId,
        repName: r.name,
        state: r.status,
        stateSince: r.statusSince,
        lastEventAt: null,
        stale: false,
        leadId: null,
        leadName: "",
        city: "",
        campaignName: "",
        callsToday: callsToday[r.userId] ?? 0,
        aiActiveCount: r.aiActiveCount,
      }));

    // The scan order a supervisor wants: connected, ringing, calling, then the
    // idle seats in mergeFloor's own rank.
    const RANK: Record<string, number> = { connected: 0, ringing: 1, calling: 2 };
    callCards.sort(
      (a, b) =>
        (RANK[String(a.state)] ?? 3) - (RANK[String(b.state)] ?? 3) ||
        a.stateSince - b.stateSince,
    );
    return [...callCards, ...seatCards];
  }, [calls, now, presence, snap]);

  // ── Filters ─────────────────────────────────────────────────────────────────
  const campaigns = useMemo(
    () =>
      [...new Set(cards.map((c) => c.campaignName).filter(Boolean))].sort(),
    [cards],
  );
  const visible = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return cards.filter((c) => {
      if (filters.state === "connected" && !(c.kind === "call" && c.state === "connected"))
        return false;
      if (
        filters.state === "dialing" &&
        !(c.kind === "call" && (c.state === "calling" || c.state === "ringing"))
      )
        return false;
      if (filters.state === "idle" && c.kind !== "rep") return false;
      if (filters.mode !== "all" && c.mode !== filters.mode) return false;
      if (filters.campaign && c.campaignName !== filters.campaign) return false;
      if (filters.staleOnly && !c.stale) return false;
      if (q && !c.repName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [cards, filters]);

  const liveCount = cards.filter((c) => c.kind === "call").length;
  const connectedCount = cards.filter(
    (c) => c.kind === "call" && c.state === "connected",
  ).length;
  const onlineCount = cards.filter(
    (c) => c.kind === "rep" && c.state !== "offline",
  ).length;

  const selected = selectedKey
    ? (cards.find((c) => c.key === selectedKey) ?? null)
    : null;

  return (
    <div className="space-y-4">
      {/* Pulse line */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
          <Radio className={cn("h-4 w-4", liveCount > 0 && "text-success")} />
          <span className="tabular">{liveCount}</span> live
        </span>
        <span className="tabular">{connectedCount} connected</span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-4 w-4" />
          <span className="tabular">{onlineCount}</span> online
        </span>
        <span className="tabular">{snap?.totalCallsToday ?? 0} calls today</span>
      </div>

      <FloorFilters
        value={filters}
        onChange={setFilters}
        campaigns={campaigns}
        view={view}
        onViewChange={changeView}
        density={density}
        onDensityChange={setDensity}
      />

      {(listen.error || actionError) && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-xs font-medium text-danger">
          {listen.error || actionError}
        </p>
      )}

      {visible.length === 0 ? (
        <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
            <Radio className="h-6 w-6" />
          </span>
          <div>
            <p className="font-semibold">
              {cards.length === 0 ? "The floor is quiet" : "Nothing matches these filters"}
            </p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {cards.length === 0
                ? "Seats appear the moment someone opens the dialer; calls move here in real time."
                : "Clear a filter to see the rest of the floor."}
            </p>
          </div>
        </Card>
      ) : view === "grid" ? (
        <div
          className={cn(
            "grid grid-cols-1 gap-4 sm:grid-cols-2",
            density === "compact" ? "gap-3 xl:grid-cols-4" : "xl:grid-cols-3",
          )}
        >
          {visible.map((card) => (
            <FloorCard
              key={card.key}
              card={card}
              now={now}
              canListen={canListen}
              canIntervene={canIntervene}
              capabilities={capabilities}
              listening={listen.listeningKey === card.key}
              listenBusy={listen.busyKey === card.key}
              onToggleListen={toggleListen}
              onEndAi={endAiCall}
              endBusy={endBusyId === card.conversationId}
              onOpen={(c) => setSelectedKey(c.key)}
              density={density}
            />
          ))}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <FloorList
            rows={visible}
            now={now}
            density={density}
            canListen={canListen}
            canIntervene={canIntervene}
            capabilities={capabilities}
            listeningKey={listen.listeningKey}
            onToggleListen={toggleListen}
            onEndAi={endAiCall}
            onOpen={(c) => setSelectedKey(c.key)}
          />
        </Card>
      )}

      <FloorDetailPanel
        card={selected}
        orgId={orgId}
        now={now}
        canListen={canListen}
        canIntervene={canIntervene}
        capabilities={capabilities}
        listening={selected ? listen.listeningKey === selected.key : false}
        listenBusy={selected ? listen.busyKey === selected.key : false}
        onToggleListen={toggleListen}
        onClose={() => setSelectedKey(null)}
        onChanged={load}
      />
    </div>
  );
}

// ── List mode (DataTable) ────────────────────────────────────────────────────

function FloorList({
  rows,
  now,
  density,
  canListen,
  canIntervene,
  capabilities,
  listeningKey,
  onToggleListen,
  onEndAi,
  onOpen,
}: {
  rows: FloorCardModel[];
  now: number;
  density: "compact" | "comfortable";
  canListen: boolean;
  canIntervene: boolean;
  capabilities: FloorCapabilities;
  listeningKey: string | null;
  onToggleListen: (card: FloorCardModel) => void;
  onEndAi: (conversationId: string) => void;
  onOpen: (card: FloorCardModel) => void;
}) {
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (c: FloorCardModel): string | number => {
      switch (sort.key) {
        case "rep":
          return c.repName.toLowerCase();
        case "duration":
          return -(now - c.stateSince); // longer first when asc
        case "calls":
          return c.callsToday;
        default:
          return 0;
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a);
      const bv = val(b);
      return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
    });
  }, [rows, sort, now]);

  const columns: DataTableColumn<FloorCardModel>[] = [
    {
      key: "rep",
      header: "Rep",
      sortable: true,
      render: (c) => (
        <span className="flex min-w-0 items-center gap-2.5">
          <Avatar
            initials={initials(c.repName || "?")}
            seed={c.repUserId ?? c.repName}
            size="sm"
          />
          <span className="min-w-0">
            <span className="block truncate font-semibold">
              {c.repName || (c.mode === "ai" ? "AI agent" : "Teammate")}
            </span>
            {c.campaignName && (
              <span className="block truncate text-xs text-muted-foreground">
                {c.campaignName}
              </span>
            )}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (c) => (
        <span className="inline-flex items-center gap-1.5">
          <StatusPill state={c.state} />
          {c.stale && (
            <span className="rounded-full bg-warning/15 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-warning">
              Stale
            </span>
          )}
        </span>
      ),
    },
    {
      key: "mode",
      header: "Mode",
      render: (c) =>
        c.mode ? (
          <span className="text-xs font-medium capitalize">{c.mode}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "lead",
      header: "Talking to",
      render: (c) =>
        c.leadName ? (
          <span className="block max-w-48 truncate">{c.leadName}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: "duration",
      header: "In state",
      sortable: true,
      align: "right",
      render: (c) => (
        <span className="font-mono text-xs font-bold tabular">
          {formatDuration(Math.max(0, Math.floor((now - c.stateSince) / 1000)))}
        </span>
      ),
    },
    {
      key: "calls",
      header: "Today",
      sortable: true,
      align: "right",
      render: (c) => <span className="tabular">{c.callsToday}</span>,
    },
    {
      key: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      render: (c) =>
        c.kind === "call" ? (
          <Menu>
            <MenuTrigger
              label="Call actions"
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            >
              <MoreHorizontal className="h-4 w-4" />
            </MenuTrigger>
            <MenuItem
              disabled={Boolean(listenDisabledReason(c, canListen, capabilities))}
              title={listenDisabledReason(c, canListen, capabilities) ?? undefined}
              onSelect={() => onToggleListen(c)}
            >
              {listeningKey === c.key ? "Stop listening" : "Listen live"}
            </MenuItem>
            {c.mode === "ai" && c.conversationId && (
              <MenuItem
                danger
                icon={PhoneOff}
                disabled={!canIntervene}
                title={
                  canIntervene
                    ? undefined
                    : "Your role can't intervene on live calls."
                }
                onSelect={() => {
                  if (c.conversationId) onEndAi(c.conversationId);
                }}
              >
                End AI call
              </MenuItem>
            )}
          </Menu>
        ) : null,
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={sorted}
      rowKey={(c) => c.key}
      sort={sort}
      onSort={(key) =>
        setSort((cur) =>
          cur?.key === key
            ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
            : { key, dir: "asc" },
        )
      }
      density={density}
      stickyHeader
      onRowClick={onOpen}
      empty={
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Nothing on the floor matches.
        </div>
      }
    />
  );
}
