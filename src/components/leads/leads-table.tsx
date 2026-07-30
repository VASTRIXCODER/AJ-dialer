"use client";

import { motion } from "framer-motion";
import {
  BatteryCharging,
  Car,
  Loader2,
  Pencil,
  PhoneCall,
  Search,
  Sparkles,
  Trash2,
  UploadCloud,
  UserCheck,
  Users,
  Waves,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { LEAD_GROUPS, type Lead, type LeadStatus } from "@/lib/types";
import { leadStatusConfig } from "@/lib/status";
import { applyLabelOverride } from "@/lib/leads/group-labels";
import { SMART_LISTS, countSmartLists, smartListById } from "@/lib/leads/smart-lists";
import { cn, formatAddress, formatCurrency, formatPhone, initials } from "@/lib/utils";
import { EditLeadDialog } from "./edit-lead-dialog";

const FILTERS: Array<{ value: LeadStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "callback", label: "Callback" },
  { value: "appointment", label: "Appointment" },
];

const GROUP_LABELS: Record<(typeof LEAD_GROUPS)[number], string> = {
  fresno: "Fresno",
  houston: "Houston",
  dallas: "Dallas",
  california: "California",
  manual: "Manual Dialing",
};

export function LeadsTable({
  leads,
  campaigns = [],
  canManage = false,
  meId = null,
  members = [],
  labelOverrides,
}: {
  leads: Lead[];
  campaigns?: { id: string; name: string }[];
  /** Whether the viewer can delete/reassign leads (managers+). Gates that UI. */
  canManage?: boolean;
  /** Viewer's user id — labels their own uploader section "Your uploads". */
  meId?: string | null;
  /** Org members (id = user id) — targets for reassigning leads between accounts. */
  members?: { id: string; name: string }[];
  /** Per-org display-label overrides for the dropbox groups (display only). */
  labelOverrides?: Record<string, string>;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<LeadStatus | "all">("all");
  const [smartList, setSmartList] = useState<string | null>(null);
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [uploaderFilter, setUploaderFilter] = useState<string>("all");
  // "My leads" = uploaded by me OR assigned to me — the same working set the
  // dialer's toggle uses, so the two screens agree on what "mine" means.
  // Deliberately broader than the "Your uploads" option in the uploader
  // dropdown, which is owner-only and would hide leads a manager routed to you.
  const [mineOnly, setMineOnly] = useState(false);
  // Remembered per user across visits, matching the dialer's toggle. Read after
  // mount rather than in the initializer so the server-rendered markup matches.
  const mineKey = meId ? `aj:leadsMineOnly:${meId}` : null;
  useEffect(() => {
    if (!mineKey) return;
    try {
      const saved = window.localStorage.getItem(mineKey);
      if (saved != null) setMineOnly(saved === "1");
    } catch {
      /* storage disabled — the toggle just won't persist */
    }
  }, [mineKey]);
  const setMineOnlyPersisted = (v: boolean) => {
    setMineOnly(v);
    if (mineKey) {
      try {
        window.localStorage.setItem(mineKey, v ? "1" : "0");
      } catch {
        /* noop */
      }
    }
  };
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignTo, setAssignTo] = useState("");
  const [reassignTo, setReassignTo] = useState("");
  const [assignRepTo, setAssignRepTo] = useState("");
  const [busy, setBusy] = useState(false);
  // Ids queued for deletion, awaiting confirmation (individual = 1, bulk = many).
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Lead | null>(null);

  // Checkboxes are useful for bulk-assign (campaigns) and bulk-delete. Every
  // viewer can now bulk-delete SOMETHING (a rep, their own uploads), so the
  // column is no longer supervisor-only.
  const selectable = canManage || campaigns.length > 0 || Boolean(meId);

  // Mirrors deleteLeads()' server-side scoping: a supervisor may delete anything
  // in the org pool, a rep only what they uploaded. Kept in lockstep so the UI
  // never offers a delete the API will refuse.
  const canDeleteLead = useCallback(
    (l: Lead) => canManage || (Boolean(meId) && l.ownerId === meId),
    [canManage, meId],
  );

  const leadById = useMemo(() => new Map(leads.map((l) => [l.id, l])), [leads]);

  // The selected ids this viewer is actually allowed to delete. A rep who
  // selects a mixed batch deletes only their own rows rather than seeing the
  // whole action fail.
  const deletableSelected = useMemo(
    () =>
      [...selected].filter((id) => {
        const l = leadById.get(id);
        return l ? canDeleteLead(l) : false;
      }),
    [selected, leadById, canDeleteLead],
  );

  const campaignName = useMemo(
    () => new Map(campaigns.map((c) => [c.id, c.name])),
    [campaigns],
  );

  // Distinct uploaders present in the data — powers the "Uploaded by" filter
  // (only meaningful for supervisors, who see more than one).
  const uploaders = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of leads) {
      if (!l.ownerId) continue;
      m.set(
        l.ownerId,
        meId && l.ownerId === meId
          ? "Your uploads"
          : l.ownerName?.trim() || "Teammate",
      );
    }
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [leads, meId]);

  // Is there anything for "My leads" to hide? False for a rep who only ever
  // sees their own book, in which case the toggle is pointless noise.
  const hasOthersLeads = useMemo(
    () =>
      Boolean(meId) &&
      leads.some((l) => l.ownerId !== meId && l.assignedRepId !== meId),
    [leads, meId],
  );

  // Counts for the smart-list chips — over ALL leads so they stay stable as
  // other filters change. Cheap pure evaluation, same idiom as the row filter.
  const smartCounts = useMemo(() => countSmartLists(leads), [leads]);
  const activeSmartList = smartList ? smartListById(smartList) : undefined;

  const filtered = useMemo(() => {
    return leads.filter((l) => {
      const matchesFilter = filter === "all" || l.status === filter;
      const matchesSmart = !activeSmartList || activeSmartList.match(l);
      const matchesCampaign =
        campaignFilter === "all" ||
        (campaignFilter === "none" ? !l.campaignId : l.campaignId === campaignFilter);
      const matchesUploader =
        uploaderFilter === "all" || l.ownerId === uploaderFilter;
      const matchesMine =
        !mineOnly || (Boolean(meId) && (l.ownerId === meId || l.assignedRepId === meId));
      const matchesGroup =
        groupFilter === "all" ||
        (groupFilter === "unsorted" ? !l.leadGroup : l.leadGroup === groupFilter);
      const q = query.trim().toLowerCase();
      const matchesQuery =
        !q ||
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        l.utilityProvider.toLowerCase().includes(q);
      return (
        matchesFilter &&
        matchesSmart &&
        matchesCampaign &&
        matchesUploader &&
        matchesMine &&
        matchesGroup &&
        matchesQuery
      );
    });
  }, [
    leads,
    filter,
    activeSmartList,
    campaignFilter,
    uploaderFilter,
    mineOnly,
    meId,
    groupFilter,
    query,
  ]);

  const allSelected = filtered.length > 0 && filtered.every((l) => selected.has(l.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(filtered.map((l) => l.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function assign() {
    if (selected.size === 0 || !assignTo) return;
    setBusy(true);
    try {
      await fetch("/api/leads/assign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadIds: [...selected],
          campaignId: assignTo === "none" ? null : assignTo,
        }),
      });
      setSelected(new Set());
      setAssignTo("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Move the selected leads to another account (uploader). Changes who owns them,
  // so they shift into that rep's dial queue + Leads-tab section.
  async function reassign() {
    if (selected.size === 0 || !reassignTo) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/leads/reassign", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds: [...selected], toUserId: reassignTo }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        updated?: number;
        error?: string;
      };
      if (!res.ok || json.error) {
        setErr(json.error ?? "Couldn’t reassign those leads.");
        return;
      }
      setSelected(new Set());
      setReassignTo("");
      router.refresh();
    } catch {
      setErr("Network error while reassigning.");
    } finally {
      setBusy(false);
    }
  }

  // Assign the selected leads to a rep WITHOUT changing the uploader — they enter
  // that rep's dial queue + Leads tab (owner_id is untouched, so attribution to
  // whoever imported the list is preserved). "" target clears the assignment.
  async function assignToRep(clear = false) {
    if (selected.size === 0 || (!clear && !assignRepTo)) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/leads/assign-rep", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadIds: [...selected],
          toUserId: clear ? null : assignRepTo,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        updated?: number;
        error?: string;
      };
      if (!res.ok || json.error) {
        setErr(json.error ?? "Couldn’t assign those leads.");
        return;
      }
      setSelected(new Set());
      setAssignRepTo("");
      router.refresh();
    } catch {
      setErr("Network error while assigning.");
    } finally {
      setBusy(false);
    }
  }

  // Split the selected leads evenly across every teammate, giving each their own
  // owned subset — the one-click fix for a batch imported under one account.
  async function distribute() {
    if (selected.size === 0 || members.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/leads/distribute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadIds: [...selected],
          toUserIds: members.map((m) => m.id),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        updated?: number;
        error?: string;
      };
      if (!res.ok || json.error) {
        setErr(json.error ?? "Couldn’t distribute those leads.");
        return;
      }
      setSelected(new Set());
      router.refresh();
    } catch {
      setErr("Network error while distributing.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete?.length) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/leads/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds: pendingDelete }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        deleted?: number;
        error?: string;
      };
      if (!res.ok || json.error) {
        setErr(json.error ?? "Couldn’t delete those leads.");
        return;
      }
      setSelected(new Set());
      setPendingDelete(null);
      router.refresh();
    } catch {
      setErr("Network error while deleting.");
    } finally {
      setBusy(false);
    }
  }

  const deleteCount = pendingDelete?.length ?? 0;

  // Group leads into per-uploader sections. Reps only ever see their own uploads
  // (one group → headers stay hidden); supervisors see every account's leads
  // split into labeled sections so it's clear who owns what.
  const groups = useMemo(() => {
    const m = new Map<string, { key: string; label: string; leads: Lead[] }>();
    for (const l of filtered) {
      const key = l.ownerId ?? "__none__";
      let g = m.get(key);
      if (!g) {
        const label =
          meId && l.ownerId === meId
            ? "Your uploads"
            : l.ownerName?.trim() || (l.ownerId ? "Teammate" : "Unattributed");
        g = { key, label, leads: [] };
        m.set(key, g);
      }
      g.leads.push(l);
    }
    return [...m.values()].sort((a, b) => b.leads.length - a.leads.length);
  }, [filtered, meId]);
  const sectioned = groups.length > 1;
  const colSpan = selectable ? 9 : 8;

  return (
    <div className="space-y-4">
      {/* Smart lists — auto-updating segments. Only shows chips that currently
          match at least one lead, so the row stays relevant as data changes. */}
      {SMART_LISTS.some((sl) => smartCounts[sl.id] > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Smart lists
          </span>
          {SMART_LISTS.filter((sl) => smartCounts[sl.id] > 0).map((sl) => {
            const active = smartList === sl.id;
            return (
              <button
                key={sl.id}
                type="button"
                title={sl.description}
                onClick={() => setSmartList(active ? null : sl.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-background/50 text-muted-foreground hover:bg-muted",
                )}
              >
                {sl.label}
                <span
                  className={cn(
                    "rounded-full px-1.5 tabular",
                    active ? "bg-white/20" : "bg-muted text-foreground",
                  )}
                >
                  {smartCounts[sl.id]}
                </span>
              </button>
            );
          })}
          {smartList && (
            <button
              type="button"
              onClick={() => setSmartList(null)}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, city, phone…"
            className="h-10 w-full rounded-xl border border-border bg-background/40 pl-9 pr-3 text-sm transition-all focus-visible:border-primary/50 focus-visible:bg-background/70 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/15"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Only worth showing when there's something to filter OUT — a rep
              whose leads are all their own would just get a no-op control. */}
          {hasOthersLeads && (
            <button
              type="button"
              onClick={() => setMineOnlyPersisted(!mineOnly)}
              aria-pressed={mineOnly}
              title="Show only leads you uploaded or that are assigned to you"
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors",
                mineOnly
                  ? "border-primary/60 bg-primary-soft text-primary"
                  : "border-border bg-background/60 text-muted-foreground hover:bg-muted",
              )}
            >
              <UserCheck className="h-3.5 w-3.5" />
              My leads
            </button>
          )}
          {uploaders.length > 1 && (
            <select
              value={uploaderFilter}
              onChange={(e) => setUploaderFilter(e.target.value)}
              aria-label="Filter by uploader"
              disabled={mineOnly}
              className="h-9 rounded-lg border border-border bg-background/60 px-2.5 text-sm font-medium focus-visible:border-primary/50 focus-visible:outline-none"
            >
              <option value="all">All uploaders</option>
              {uploaders.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          )}
          {campaigns.length > 0 && (
            <select
              value={campaignFilter}
              onChange={(e) => setCampaignFilter(e.target.value)}
              className="h-9 rounded-lg border border-border bg-background/60 px-2.5 text-sm font-medium focus-visible:border-primary/50 focus-visible:outline-none"
            >
              <option value="all">All campaigns</option>
              <option value="none">Unassigned</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {leads.some((l) => l.leadGroup) && (
            <select
              value={groupFilter}
              onChange={(e) => setGroupFilter(e.target.value)}
              aria-label="Filter by group"
              className="h-9 rounded-lg border border-border bg-background/60 px-2.5 text-sm font-medium focus-visible:border-primary/50 focus-visible:outline-none"
            >
              <option value="all">All groups</option>
              <option value="unsorted">Unsorted</option>
              {LEAD_GROUPS.map((g) => (
                <option key={g} value={g}>
                  {applyLabelOverride(g, GROUP_LABELS[g], labelOverrides)}
                </option>
              ))}
            </select>
          )}
          {FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={cn(
                  "relative rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-200",
                  active ? "text-background" : "bg-muted text-muted-foreground hover:bg-secondary",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="leads-filter"
                    className="absolute inset-0 z-0 rounded-lg bg-foreground"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative z-10">{f.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Delete confirmation — takes over the action bar while pending */}
      {pendingDelete && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2">
          <Trash2 className="h-4 w-4 text-danger" />
          <span className="text-sm font-semibold text-danger">
            Delete {deleteCount} lead{deleteCount === 1 ? "" : "s"}? This can’t be undone.
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={confirmDelete}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Delete
            </Button>
            <button
              type="button"
              onClick={() => {
                setPendingDelete(null);
                setErr("");
              }}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bulk action bar */}
      {!pendingDelete && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-primary-soft/40 px-3 py-2">
          <span className="text-sm font-semibold text-primary">{selected.size} selected</span>
          {campaigns.length > 0 && (
            <>
              <span className="text-sm text-muted-foreground">Assign to</span>
              <select
                value={assignTo}
                onChange={(e) => setAssignTo(e.target.value)}
                className="h-8 rounded-lg border border-border bg-background px-2 text-sm focus-visible:border-primary/50 focus-visible:outline-none"
              >
                <option value="">Choose…</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="none">— Remove from campaign —</option>
              </select>
              <Button size="sm" className="gap-1.5" disabled={!assignTo || busy} onClick={assign}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Apply
              </Button>
            </>
          )}
          {canManage && members.length > 0 && (
            <>
              <span className="text-sm text-muted-foreground">Reassign to</span>
              <select
                value={reassignTo}
                onChange={(e) => setReassignTo(e.target.value)}
                aria-label="Reassign selected leads to"
                className="h-8 rounded-lg border border-border bg-background px-2 text-sm focus-visible:border-primary/50 focus-visible:outline-none"
              >
                <option value="">Choose teammate…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === meId ? "Me" : m.name || "Member"}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={!reassignTo || busy}
                onClick={reassign}
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Reassign
              </Button>
              {members.length > 1 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy}
                  onClick={distribute}
                  title="Split the selected leads evenly across every teammate, giving each their own owned set"
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Users className="h-3.5 w-3.5" />
                  )}
                  Distribute evenly
                </Button>
              )}
              {/* Non-destructive assignment: routes leads to a rep's queue while
                  KEEPING the original uploader (unlike Reassign, which moves
                  ownership). This is how a rep dials "only my leads" when a
                  manager imported the list under their own account. */}
              <span className="text-sm text-muted-foreground">Assign to rep</span>
              <select
                value={assignRepTo}
                onChange={(e) => setAssignRepTo(e.target.value)}
                aria-label="Assign selected leads to a rep (keeps the uploader)"
                className="h-8 rounded-lg border border-border bg-background px-2 text-sm focus-visible:border-primary/50 focus-visible:outline-none"
              >
                <option value="">Choose teammate…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.id === meId ? "Me" : m.name || "Member"}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={!assignRepTo || busy}
                onClick={() => assignToRep(false)}
                title="Add these leads to the chosen rep's dial queue without changing who uploaded them"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Assign
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                disabled={busy}
                onClick={() => assignToRep(true)}
                title="Clear the rep assignment on the selected leads"
              >
                Unassign
              </Button>
            </>
          )}
          {deletableSelected.length > 0 && (
            <Button
              variant="danger"
              size="sm"
              className="gap-1.5"
              onClick={() => setPendingDelete(deletableSelected)}
              title={
                deletableSelected.length < selected.size
                  ? "Only the leads you uploaded can be deleted"
                  : undefined
              }
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
              {deletableSelected.length < selected.size &&
                ` ${deletableSelected.length} of ${selected.size}`}
            </Button>
          )}
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {err && <p className="text-sm font-medium text-danger">{err}</p>}

      <div className="overflow-hidden rounded-2xl border border-border/60 surface-glass">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-border/70 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {selectable && (
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="h-4 w-4 cursor-pointer rounded border-border"
                    />
                  </th>
                )}
                <th className="px-4 py-3">Homeowner</th>
                <th className="px-4 py-3">Location</th>
                <th className="px-4 py-3">Campaign</th>
                <th className="px-4 py-3 text-right">Bill</th>
                <th className="px-4 py-3">Home</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">AI</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(sectioned
                ? groups
                : [{ key: "all", label: "", leads: filtered }]
              ).map((group) => (
                <Fragment key={group.key}>
                  {sectioned && (
                    <tr className="border-t border-border bg-muted/40">
                      <td colSpan={colSpan} className="px-4 py-2.5">
                        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          <UploadCloud className="h-3.5 w-3.5" />
                          {group.label}
                          <span className="rounded-full bg-background px-2 py-0.5 tabular text-foreground">
                            {group.leads.length}
                          </span>
                        </div>
                      </td>
                    </tr>
                  )}
                  {group.leads.map((l, i) => {
                    const name = `${l.firstName} ${l.lastName}`;
                    const cfg = leadStatusConfig[l.status];
                    const isSel = selected.has(l.id);
                    return (
                  <motion.tr
                    key={l.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i, 14) * 0.025, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                    className={cn("group transition-colors hover:bg-muted/50", isSel && "bg-primary-soft/30")}
                  >
                    {selectable && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={isSel}
                          onChange={() => toggleOne(l.id)}
                          aria-label={`Select ${name}`}
                          className="h-4 w-4 cursor-pointer rounded border-border"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar initials={initials(name)} color="#3B82F6" size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold">{name || "—"}</p>
                          <p className="text-xs text-muted-foreground tabular">
                            {l.phone ? formatPhone(l.phone) : "No phone"}
                          </p>
                          {l.email && (
                            <p className="truncate text-xs text-muted-foreground">{l.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <div className="min-w-0 max-w-[280px]">
                        {formatAddress(l) ? (
                          <p className="break-words" title={formatAddress(l)}>
                            {formatAddress(l)}
                          </p>
                        ) : (
                          <p>—</p>
                        )}
                        {(l.utilityProvider || l.solarProvider) && (
                          <p className="truncate text-xs">
                            {[l.utilityProvider, l.solarProvider].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        {l.campaignId && campaignName.get(l.campaignId) ? (
                          <Badge tone="accent">{campaignName.get(l.campaignId)}</Badge>
                        ) : null}
                        {/* Manual Dialing and unsorted are structurally opposite (a
                            deliberate human bucket vs. "AI couldn't place this") —
                            distinct tones so they're never visually conflated. */}
                        {l.leadGroup && (
                          <Badge tone={l.leadGroup === "manual" ? "neutral" : "primary"}>
                            {applyLabelOverride(l.leadGroup, GROUP_LABELS[l.leadGroup], labelOverrides)}
                          </Badge>
                        )}
                        {!l.campaignId && !l.leadGroup && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular">
                      {l.utilityBill ? formatCurrency(l.utilityBill) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 text-muted-foreground">
                        {l.hasEV && <Car className="h-4 w-4" />}
                        {l.hasPool && <Waves className="h-4 w-4" />}
                        {l.hasBattery && <BatteryCharging className="h-4 w-4" />}
                        {!l.hasEV && !l.hasPool && !l.hasBattery && <span className="text-xs">—</span>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={cfg.tone}>{cfg.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={cn(
                          "font-bold tabular",
                          (l.aiScore ?? 0) >= 85
                            ? "text-success"
                            : (l.aiScore ?? 0) >= 70
                              ? "text-warning"
                              : "text-muted-foreground",
                        )}
                      >
                        {l.aiScore ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href="/dialer"
                          className={buttonVariants({
                            size: "sm",
                            variant: "ghost",
                            className: "gap-1.5 opacity-0 group-hover:opacity-100",
                          })}
                        >
                          <PhoneCall className="h-3.5 w-3.5" />
                          Call
                        </Link>
                        {(canManage || l.ownerId === meId) && (
                          <button
                            type="button"
                            onClick={() => setEditing(l)}
                            aria-label={`Edit ${name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-colors hover:bg-muted hover:text-foreground group-hover:opacity-100"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {canDeleteLead(l) && (
                          <button
                            type="button"
                            onClick={() => setPendingDelete([l.id])}
                            aria-label={`Delete ${name}`}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-colors hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            No leads match your filters.
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {leads.length} leads
      </p>

      {editing && <EditLeadDialog lead={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
