"use client";

import { motion } from "framer-motion";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  BatteryCharging,
  BookmarkPlus,
  Car,
  ChevronsUpDown,
  ListFilter,
  Loader2,
  Pencil,
  PhoneCall,
  Search,
  Sparkles,
  Star,
  Trash2,
  UploadCloud,
  UserCheck,
  Users,
  Waves,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Drawer } from "@/components/ui/drawer";
import { Input, Label } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { Lead, LeadStatus } from "@/lib/types";
import {
  CORE_LEAD_FIELDS,
  formatFieldValue,
  leadFieldValue,
  type LeadFieldDef,
} from "@/lib/leads/field-schema";
import { dialDeepLink } from "@/lib/dialer/deep-link";
import { encodeFilterParam, type FilterSpec } from "@/lib/leads/filter-spec";
import { leadStatusConfig, resolveLeadStatusConfig } from "@/lib/status";
import { applyLabelOverride } from "@/lib/leads/group-labels";
import type { SmartListTone } from "@/lib/leads/smart-lists";
import { cn, formatAddress, formatNumber, formatPhone, initials } from "@/lib/utils";
import { EditLeadDialog } from "./edit-lead-dialog";
import { FilterBuilder } from "./filter-builder";
import { useLead360 } from "./lead-360/lead-360-provider";

/** The server-side filter set, mirrored in the URL (see leads/page.tsx). */
export interface LeadsTableFilters {
  q?: string;
  status?: LeadStatus;
  smart?: string;
  /** Group key; "__misc__" = ungrouped. */
  group?: string;
  /** "County|ST" composite (e.g. "Fresno|CA"); "__none__" = no county on file. */
  county?: string;
  /** "City|ST" composite (e.g. "Fresno|CA"); "__none__" = no city on file. */
  city?: string;
  /** Campaign id; "__none__" = unassigned. */
  campaignId?: string;
  uploaderId?: string;
  mine?: boolean;
  /** Server-side sort as "key.dir" (e.g. "ai_score.desc") — whitelisted in
   *  leads/page.tsx AND again inside the SQL. Absent = upload order. */
  sort?: string;
  /** Encoded FilterSpec (?f=) — the typed-filter grammar. When present the
   *  server row set comes from app_filter_leads and the legacy params above
   *  are ignored for the read (they stay in the URL for when it clears). */
  f?: string;
}

/**
 * One smart-list chip, PRE-DIGESTED server-side (leads/page.tsx): the list's
 * filter is already sanitized and encoded to its canonical ?f= param, and the
 * schema-validation warnings are already resolved against the org's fields —
 * the client just renders and navigates, it never re-derives filter truth.
 */
export interface SmartListChip {
  id: string;
  /** Seed key ('fresh', …) — null for user-created lists. Matches legacy ?smart=. */
  key: string | null;
  name: string;
  description: string;
  tone: SmartListTone;
  favorite: boolean;
  /** Canonical encodeFilterParam of the list's filter ("" = unusable). */
  param: string;
  /** validateSmartListFilter output — non-empty renders the amber dot. */
  warnings: string[];
  /** Viewer may toggle favorite (owner, or manager+ for shared lists). */
  canEdit: boolean;
}

/** Tone → dot color, all semantic tokens (never hex). */
const TONE_DOT: Record<SmartListTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
  primary: "bg-primary",
  neutral: "bg-muted-foreground",
};

const FILTERS: Array<{ value: LeadStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "callback", label: "Callback" },
  { value: "appointment", label: "Appointment" },
];

/** Human labels for the ORIGINAL fixed keys, used only when a lead carries a
 *  key the org's current group list no longer contains (e.g. a group deleted
 *  after those leads were filed) — better a readable name than a raw slug. */
const LEGACY_GROUP_LABELS: Record<string, string> = {
  fresno: "Fresno",
  houston: "Houston",
  dallas: "Dallas",
  california: "California",
  manual: "Manual Dialing",
};

/** Core field keys → the app_leads_page sort-whitelist key backing them. Only
 *  these schema columns get sortable headers — custom fields sit in jsonb with
 *  no SQL sort lane, so their headers stay static. */
const CORE_FIELD_SORTS: Record<string, string> = {
  utilityBill: "utility_bill",
  solarPayment: "solar_payment",
};

/** "Fresno" + "CA" -> "Fresno County, CA". Falls back gracefully when state is
 *  missing (shouldn't happen — county is only ever set alongside state — but
 *  cheap to guard) so the dropdown never renders a trailing ", ". */
const formatCountyLabel = (county: string, state: string) =>
  state ? `${county} County, ${state}` : `${county} County`;

/** Boolean core slots keep their signature icons; other booleans get a badge. */
const FLAG_ICONS: Record<string, typeof Car> = {
  hasEV: Car,
  hasPool: Waves,
  hasBattery: BatteryCharging,
};

type SortState = { key: string; dir: "asc" | "desc" } | null;

/**
 * A sortable column header. Click cycles: the column's natural direction →
 * the opposite → back to upload order (the deliberate default). The chevron
 * pair only surfaces on hover so resting headers stay quiet.
 */
function SortableTh({
  label,
  sortKey,
  numeric = false,
  sort,
  onToggle,
}: {
  label: string;
  sortKey: string;
  /** Right-aligns and makes DESC the first-click direction (big values first). */
  numeric?: boolean;
  sort: SortState;
  onToggle: (key: string, defaultDir: "asc" | "desc") => void;
}) {
  const dir = sort?.key === sortKey ? sort.dir : null;
  return (
    <th
      aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : undefined}
      className={cn("px-4 py-3", numeric && "text-right")}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey, numeric ? "desc" : "asc")}
        title={`Sort by ${label.toLowerCase()}`}
        className={cn(
          "group/sort inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide transition-colors",
          dir ? "text-foreground" : "text-muted-foreground hover:text-foreground",
        )}
      >
        {label}
        {dir === "asc" ? (
          <ArrowUp className="h-3 w-3 text-primary" />
        ) : dir === "desc" ? (
          <ArrowDown className="h-3 w-3 text-primary" />
        ) : (
          <ChevronsUpDown className="h-3 w-3 opacity-0 transition-opacity group-hover/sort:opacity-60" />
        )}
      </button>
    </th>
  );
}

export function LeadsTable({
  leads,
  total,
  page,
  pageSize,
  smartLists = [],
  filters,
  campaigns = [],
  canManage = false,
  meId = null,
  members = [],
  labelOverrides,
  orgGroups = [],
  orgCounties = [],
  orgCities = [],
  fields = CORE_LEAD_FIELDS,
  showSolarPayment = true,
  filterSpec = null,
}: {
  /** ONE server-filtered page of rows — filtering happens in getLeadsPage. */
  leads: Lead[];
  /** Rows matching the current filters (the pagination denominator). */
  total: number;
  page: number;
  pageSize: number;
  /** The org's smart lists (DB rows via listSmartLists), favorites first. */
  smartLists?: SmartListChip[];
  /** The active URL-driven filters this page was rendered with. */
  filters: LeadsTableFilters;
  campaigns?: { id: string; name: string }[];
  /** Whether the viewer can delete/reassign leads (managers+). Gates that UI. */
  canManage?: boolean;
  /** Viewer's user id — labels their own uploader section "Your uploads". */
  meId?: string | null;
  /** Org members (id = user id) — targets for reassigning leads between accounts. */
  members?: { id: string; name: string }[];
  /** Legacy per-org display-label overrides. The group's own label (below) is
   *  the primary source now; an override still wins for orgs that set one. */
  labelOverrides?: Record<string, string>;
  /** The org's own intake groups. Empty falls back to whatever the loaded leads
   *  carry, so the filter is never empty just because the list didn't load. */
  orgGroups?: { key: string; label: string }[];
  /** Distinct (county, state) pairs across the viewer's scope — see
   *  listPlaces. Drives the county filter; empty just hides it.
   *  ALREADY IN UPLOAD ORDER: render as given, never re-sort. */
  orgCounties?: { county: string; state: string }[];
  /** Distinct (city, state) pairs across the viewer's scope — see listPlaces.
   *  ALREADY IN UPLOAD ORDER (first appearance in the book, not A-Z): render
   *  as given, never re-sort. */
  orgCities?: { city: string; state: string }[];
  /** The org's resolved lead-field schema (resolveLeadFields) — drives which
   *  data columns render. Defaults to the solar-era core slots. */
  fields?: LeadFieldDef[];
  /** Show solar-specific fields (per-tenant — off for non-solar orgs). */
  showSolarPayment?: boolean;
  /** The SANITIZED spec behind filters.f (decoded server-side) — seeds the
   *  filter summary bar and the builder drawer. */
  filterSpec?: FilterSpec | null;
}) {
  const router = useRouter();
  const vocab = useVocabulary();
  const lead360 = useLead360();
  const confirm = useConfirm();
  const [isPending, startTransition] = useTransition();

  // Every filter lives in the URL — the server does the actual filtering, so
  // changing one is a navigation, not a state update. replace() keeps the
  // history clean while typing; page resets to 1 on any filter change.
  const navigate = useCallback(
    (next: LeadsTableFilters, nextPage: number) => {
      const sp = new URLSearchParams();
      if (next.q) sp.set("q", next.q);
      if (next.status) sp.set("status", next.status);
      if (next.smart) sp.set("smart", next.smart);
      if (next.group) sp.set("group", next.group);
      if (next.county) sp.set("county", next.county);
      if (next.city) sp.set("city", next.city);
      if (next.campaignId) sp.set("campaign", next.campaignId);
      if (next.uploaderId) sp.set("uploader", next.uploaderId);
      if (next.mine) sp.set("mine", "1");
      if (next.sort) sp.set("sort", next.sort);
      if (next.f) sp.set("f", next.f);
      if (nextPage > 1) sp.set("page", String(nextPage));
      const qs = sp.toString();
      startTransition(() => {
        router.replace(qs ? `/leads?${qs}` : "/leads", { scroll: false });
      });
    },
    [router],
  );
  // Merge every change onto the latest INTENDED filters, not the server-
  // rendered prop: the prop only updates when the RSC round trip lands, so two
  // quick changes (click a status chip, then a smart chip — or type while a
  // chip navigation is pending) would silently drop the first one.
  const intendedFilters = useRef(filters);
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    // Re-sync only when the SERVER-CONFIRMED filters actually changed value —
    // a parent re-render mid-transition passes the same old values under a new
    // object identity and must not revert a pending intent.
    intendedFilters.current = filters;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey]);
  const applyFilters = useCallback(
    (patch: Partial<LeadsTableFilters>) => {
      const next = { ...intendedFilters.current, ...patch };
      intendedFilters.current = next;
      navigate(next, 1);
    },
    [navigate],
  );
  const goToPage = useCallback(
    (p: number) => navigate(intendedFilters.current, Math.max(1, p)),
    [navigate],
  );

  // Sort state lives in the URL like every other filter ("key.dir"), rendered
  // from the server-confirmed value so headers never show a sort that wasn't
  // applied. Changing it resets to page 1 via applyFilters.
  const activeSort: SortState = useMemo(() => {
    const raw = filters.sort ?? "";
    const dot = raw.indexOf(".");
    if (dot <= 0) return null;
    return { key: raw.slice(0, dot), dir: raw.slice(dot + 1) === "desc" ? "desc" : "asc" };
  }, [filters.sort]);
  const toggleSort = useCallback(
    (key: string, defaultDir: "asc" | "desc") => {
      let next: string | undefined;
      if (activeSort?.key !== key) next = `${key}.${defaultDir}`;
      else if (activeSort.dir === defaultDir)
        next = `${key}.${defaultDir === "asc" ? "desc" : "asc"}`;
      else next = undefined; // third click: back to upload order
      applyFilters({ sort: next });
    },
    [activeSort, applyFilters],
  );

  // Schema-driven data columns. Booleans collapse into ONE compact flag cell
  // (the old "Home" column, generalized); everything else gets its own column.
  // Custom columns cap at 4 to keep row density sane — everything a lead
  // carries beyond that stays reachable through the edit dialog.
  const { valueColumns, flagFields } = useMemo(() => {
    const visible = fields.filter((f) => f.showInTable);
    const shown = [
      ...visible.filter((f) => f.source === "core"),
      ...visible.filter((f) => f.source === "custom").slice(0, 4),
    ];
    return {
      valueColumns: shown.filter((f) => f.type !== "boolean"),
      flagFields: shown.filter((f) => f.type === "boolean"),
    };
  }, [fields]);

  // Filter options = the org's groups, plus any key the loaded leads still
  // carry that isn't in that list (a deleted group's leftovers), so a lead is
  // never unreachable by filtering.
  const groupOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const g of orgGroups) {
      seen.set(g.key, applyLabelOverride(g.key, g.label, labelOverrides));
    }
    for (const l of leads) {
      if (l.leadGroup && !seen.has(l.leadGroup)) {
        seen.set(
          l.leadGroup,
          applyLabelOverride(
            l.leadGroup,
            LEGACY_GROUP_LABELS[l.leadGroup] ?? l.leadGroup,
            labelOverrides,
          ),
        );
      }
    }
    return [...seen].map(([key, label]) => ({ key, label }));
  }, [orgGroups, leads, labelOverrides]);

  const groupLabelOf = useCallback(
    (key: string) => groupOptions.find((g) => g.key === key)?.label ?? key,
    [groupOptions],
  );

  // County options = the scope-wide distinct list from the server, plus (same
  // reasoning as groupOptions) any county a currently-loaded lead carries that
  // isn't in it — orgCounties is computed from a separate query and could in
  // principle lag a lead that was just imported this second.
  const countyOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of orgCounties) {
      seen.set(`${c.county}|${c.state}`, formatCountyLabel(c.county, c.state));
    }
    for (const l of leads) {
      if (l.county) {
        const key = `${l.county}|${l.state}`;
        if (!seen.has(key)) seen.set(key, formatCountyLabel(l.county, l.state));
      }
    }
    return [...seen].map(([key, label]) => ({ key, label }));
  }, [orgCounties, leads]);

  // City options, same shape and same rule as counties — and deliberately NOT
  // sorted here: orgCities already arrives in the order the book presents it
  // (see listPlaces), and a .sort() at this layer would silently undo that.
  // Keys are case-folded so one bucket survives "Fresno"/"fresno " spellings;
  // the label keeps whichever spelling the book showed first.
  const cityOptions = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (city: string, state: string) => {
      const c = (city ?? "").trim();
      if (!c) return;
      const s = (state ?? "").trim();
      const key = `${c.toLowerCase()}|${s.toLowerCase()}`;
      if (!seen.has(key)) seen.set(key, s ? `${c}, ${s}` : c);
    };
    for (const c of orgCities) add(c.city, c.state);
    for (const l of leads) add(l.city, l.state);
    return [...seen].map(([key, label]) => ({ key, label }));
  }, [orgCities, leads]);

  // The search input is the one filter kept in local state — for keystroke
  // responsiveness — and debounced into the URL, where the server reads it.
  const [query, setQuery] = useState(filters.q ?? "");
  const applyFiltersRef = useRef(applyFilters);
  applyFiltersRef.current = applyFilters;
  const urlQ = filters.q ?? "";
  useEffect(() => {
    const target = query.trim();
    if (target === urlQ) return;
    const t = setTimeout(
      () => applyFiltersRef.current({ q: target || undefined }),
      350,
    );
    return () => clearTimeout(t);
  }, [query, urlQ]);

  // "My leads" = uploaded by me OR assigned to me — the same working set the
  // dialer's toggle uses, so the two screens agree on what "mine" means.
  // Deliberately broader than the "Your uploads" option in the uploader
  // dropdown, which is owner-only and would hide leads a manager routed to you.
  // Remembered per user across visits (matching the dialer's toggle): on first
  // mount a saved preference is promoted into the URL, where the filter lives.
  const mineKey = meId ? `aj:leadsMineOnly:${meId}` : null;
  const mineSeeded = useRef(false);
  useEffect(() => {
    if (!mineKey || mineSeeded.current) return;
    mineSeeded.current = true;
    try {
      if (window.localStorage.getItem(mineKey) === "1" && !filters.mine) {
        applyFiltersRef.current({ mine: true });
      }
    } catch {
      /* storage disabled — the toggle just won't persist */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mineKey]);
  const setMineOnlyPersisted = (v: boolean) => {
    if (mineKey) {
      try {
        window.localStorage.setItem(mineKey, v ? "1" : "0");
      } catch {
        /* noop */
      }
    }
    applyFilters({ mine: v || undefined });
  };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Selection is page-scoped: ids from a previous page or filter would make
  // the bulk bar act on rows the user can no longer see.
  const pageKey = `${page}|${JSON.stringify(filters)}`;
  useEffect(() => {
    setSelected(new Set());
  }, [pageKey]);
  const [assignTo, setAssignTo] = useState("");
  const [reassignTo, setReassignTo] = useState("");
  const [assignRepTo, setAssignRepTo] = useState("");
  const [busy, setBusy] = useState(false);
  // Ids queued for deletion, awaiting confirmation (individual = 1, bulk = many).
  const [pendingDelete, setPendingDelete] = useState<string[] | null>(null);
  const [err, setErr] = useState("");
  const [editing, setEditing] = useState<Lead | null>(null);

  // ── Typed-filter builder (?f=) ────────────────────────────────────────────
  // The drawer edits a DRAFT seeded from the server-confirmed spec on open;
  // Apply encodes it into the URL (the server sanitizes on decode), so the
  // builder can never half-apply a filter the page didn't actually run.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [draftSpec, setDraftSpec] = useState<FilterSpec | null>(null);
  const openFilterBuilder = () => {
    setDraftSpec(filterSpec ?? null);
    setFiltersOpen(true);
  };
  const applyFilterSpec = () => {
    const enc = draftSpec ? encodeFilterParam(draftSpec) : "";
    applyFilters({ f: enc || undefined });
    setFiltersOpen(false);
  };
  const clearFilterSpec = () => applyFilters({ f: undefined });
  const activeConditionCount = useMemo(
    () =>
      filterSpec ? filterSpec.groups.reduce((n, g) => n + g.conditions.length, 0) : 0,
    [filterSpec],
  );
  // Vocabulary-resolved status labels for the builder's status value select.
  const statusOptions = useMemo(() => {
    const cfg = resolveLeadStatusConfig(vocab);
    return Object.entries(cfg).map(([value, c]) => ({ value, label: c.label }));
  }, [vocab]);

  // ── Smart lists (DB-backed chips) ─────────────────────────────────────────
  // A chip is just a pre-encoded ?f= param: clicking it navigates through the
  // SAME pipeline the filter builder uses. Active = canonical-param match (or
  // the legacy ?smart= key for old bookmarks the server didn't translate).
  const { toast } = useToast();
  const [favBusy, setFavBusy] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");
  const [saveShared, setSaveShared] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [saveErr, setSaveErr] = useState("");

  const activeSmartId = useMemo(
    () =>
      smartLists.find(
        (sl) =>
          Boolean(sl.param) &&
          (filters.f === sl.param || (sl.key != null && filters.smart === sl.key)),
      )?.id ?? null,
    [smartLists, filters.f, filters.smart],
  );

  const applySmartList = (chip: SmartListChip, active: boolean) => {
    applyFilters(
      active
        ? { f: undefined, smart: undefined }
        : { f: chip.param, smart: undefined },
    );
  };

  // Favorite is an org-level ordering bit (favorites sort first for everyone),
  // so the star only renders for viewers the API would let flip it (canEdit).
  const toggleFavorite = async (chip: SmartListChip) => {
    if (favBusy) return;
    setFavBusy(chip.id);
    try {
      const res = await fetch(`/api/smart-lists/${chip.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ favorite: !chip.favorite }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || json.error) {
        toast({
          title: "Couldn't update that list",
          description: json.error,
          tone: "danger",
        });
      } else {
        router.refresh();
      }
    } catch {
      toast({
        title: "Network error",
        description: "Couldn't update that list.",
        tone: "danger",
      });
    } finally {
      setFavBusy(null);
    }
  };

  const openSaveDialog = () => {
    setSaveName("");
    setSaveDesc("");
    // Managers curate the shared book, so their lists default to shared; a rep
    // can only save private ones (the API enforces the same line).
    setSaveShared(canManage);
    setSaveErr("");
    setSaveOpen(true);
  };

  const saveAsList = async () => {
    if (!filterSpec || !saveName.trim() || saveBusy) return;
    setSaveBusy(true);
    setSaveErr("");
    try {
      const res = await fetch("/api/smart-lists", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: saveName.trim(),
          description: saveDesc.trim(),
          shared: saveShared,
          filter: filterSpec,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok || json.error) {
        setSaveErr(json.error ?? "Couldn't save that list.");
        return;
      }
      setSaveOpen(false);
      toast({
        title: "List saved",
        description: `"${saveName.trim()}" now lives in the smart-lists row.`,
        tone: "success",
      });
      router.refresh();
    } catch {
      setSaveErr("Network error while saving.");
    } finally {
      setSaveBusy(false);
    }
  };

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

  // Options for the "Uploaded by" filter: the org's members (a supervisor's
  // reassign list) plus any owner present on the page the members list misses
  // (e.g. a departed member's leftovers) — so a lead is never unreachable.
  const uploaders = useMemo(() => {
    const m = new Map<string, string>();
    if (canManage) {
      for (const mem of members) {
        m.set(mem.id, mem.id === meId ? "Your uploads" : mem.name || "Teammate");
      }
    }
    for (const l of leads) {
      if (!l.ownerId || m.has(l.ownerId)) continue;
      m.set(
        l.ownerId,
        meId && l.ownerId === meId
          ? "Your uploads"
          : l.ownerName?.trim() || "Teammate",
      );
    }
    return [...m.entries()].map(([id, name]) => ({ id, name }));
  }, [canManage, members, leads, meId]);

  // Is there anything for "My leads" to hide? With server filtering the page
  // can't prove it, so also key off org size — and keep the toggle visible
  // while it's ACTIVE (every visible row is mine then, by construction).
  const hasOthersLeads =
    Boolean(meId) &&
    (Boolean(filters.mine) ||
      members.length > 1 ||
      leads.some((l) => l.ownerId !== meId && l.assignedRepId !== meId));

  // Rows arrive already filtered by the server — `filtered` survives only as
  // the name downstream markup renders.
  const filtered = leads;

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

  // Archive keeps the rows (history, recordings, DNC state intact) but drops
  // them from every default view — the safe alternative to delete for curating
  // the shared book. Managers+ only; /api/leads/archive re-checks server-side.
  async function archiveSelected() {
    if (selected.size === 0) return;
    const n = selected.size;
    const ok = await confirm({
      title: `Archive ${n} ${n === 1 ? vocab.leadNoun : vocab.leadNounPlural}?`,
      body: "Archived rows leave the default views and stop being dial-eligible. Nothing is deleted — they stay reachable from the Archived tile.",
      confirmLabel: "Archive",
    });
    if (!ok) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/leads/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadIds: [...selected] }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        updated?: number;
        error?: string;
      };
      if (!res.ok || json.error) {
        setErr(json.error ?? "Couldn’t archive those leads.");
        return;
      }
      setSelected(new Set());
      router.refresh();
    } catch {
      setErr("Network error while archiving.");
    } finally {
      setBusy(false);
    }
  }

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
  // Fixed columns: Homeowner/Location/Campaign + Status/AI + actions (6), plus
  // the dynamic schema columns and the optional checkbox column.
  const dynamicCols = valueColumns.length + (flagFields.length > 0 ? 1 : 0);
  const colSpan = (selectable ? 1 : 0) + 6 + dynamicCols;
  // The old fixed layout (Bill + Home = 2 dynamic columns) fit in 900px; give
  // every column beyond that its own breathing room and let the wrapper scroll.
  const tableMinWidth = 900 + Math.max(0, dynamicCols - 2) * 110;

  return (
    <div className="space-y-4">
      {/* Smart lists — DB-backed saved filters (smart_lists, favorites first).
          Clicking a chip applies the list's FilterSpec through the SAME ?f=
          pipeline as the filter builder, so a chip can never select different
          rows than its filter says. No per-chip counts: each would be a full
          filter scan on every page load. */}
      {smartLists.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" />
            Smart lists
          </span>
          {smartLists.map((sl) => {
            const active = sl.id === activeSmartId;
            return (
              // A wrapper div, not one big button — the favorite star is its
              // own control and nested buttons are invalid (and unreachable
              // by keyboard).
              <div
                key={sl.id}
                className={cn(
                  "flex items-center overflow-hidden rounded-full border transition-colors",
                  active
                    ? "border-primary bg-primary text-white"
                    : "border-border bg-background/50 text-muted-foreground",
                )}
              >
                <button
                  type="button"
                  title={
                    sl.warnings.length > 0
                      ? `${sl.description ? `${sl.description}\n` : ""}⚠ ${sl.warnings.join("\n⚠ ")}`
                      : sl.description || sl.name
                  }
                  aria-pressed={active}
                  disabled={!sl.param}
                  onClick={() => applySmartList(sl, active)}
                  className={cn(
                    "flex items-center gap-1.5 py-1 pl-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                    sl.canEdit ? "pr-1" : "pr-2.5",
                    !active && "hover:bg-muted hover:text-foreground",
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      active ? "bg-white" : TONE_DOT[sl.tone],
                    )}
                  />
                  {sl.name}
                  {sl.warnings.length > 0 && (
                    <span
                      aria-label="This list has warnings"
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        active ? "bg-white/80" : "bg-warning",
                      )}
                    />
                  )}
                </button>
                {sl.canEdit && (
                  <button
                    type="button"
                    onClick={() => void toggleFavorite(sl)}
                    disabled={favBusy === sl.id}
                    aria-pressed={sl.favorite}
                    aria-label={
                      sl.favorite
                        ? `Remove ${sl.name} from favorites`
                        : `Add ${sl.name} to favorites`
                    }
                    title={
                      sl.favorite ? "Remove from favorites" : "Favorite — favorites sort first"
                    }
                    className={cn(
                      "py-1 pl-0.5 pr-2 transition-colors",
                      active
                        ? "text-white/80 hover:text-white"
                        : "text-ink-3 hover:text-warning",
                    )}
                  >
                    {favBusy === sl.id ? (
                      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Star
                        className={cn("h-3 w-3", sl.favorite && "fill-warning text-warning")}
                      />
                    )}
                  </button>
                )}
              </div>
            );
          })}
          {activeSmartId && (
            <button
              type="button"
              onClick={() => applyFilters({ smart: undefined, f: undefined })}
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
          {/* The typed-filter builder — every FilterSpec field/operator, beyond
              the quick chips on this row. */}
          <button
            type="button"
            onClick={openFilterBuilder}
            aria-pressed={Boolean(filters.f)}
            title="Build a typed filter (any field, any operator)"
            className={cn(
              "flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors",
              filters.f
                ? "border-primary/60 bg-primary-soft text-primary"
                : "border-border bg-background/60 text-muted-foreground hover:bg-muted",
            )}
          >
            <ListFilter className="h-3.5 w-3.5" />
            Filters
            {activeConditionCount > 0 && (
              <span className="rounded-full bg-primary/15 px-1.5 text-xs tabular">
                {activeConditionCount}
              </span>
            )}
          </button>
          {/* Only worth showing when there's something to filter OUT — a rep
              whose leads are all their own would just get a no-op control. */}
          {hasOthersLeads && (
            <button
              type="button"
              onClick={() => setMineOnlyPersisted(!filters.mine)}
              aria-pressed={Boolean(filters.mine)}
              title="Show only leads you uploaded or that are assigned to you"
              className={cn(
                "flex h-9 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium transition-colors",
                filters.mine
                  ? "border-primary/60 bg-primary-soft text-primary"
                  : "border-border bg-background/60 text-muted-foreground hover:bg-muted",
              )}
            >
              <UserCheck className="h-3.5 w-3.5" />
              My leads
            </button>
          )}
          {(uploaders.length > 1 || filters.uploaderId) && (
            <SelectMenu
              label="Filter by uploader"
              size="sm"
              triggerClassName="h-9"
              disabled={Boolean(filters.mine)}
              disabledReason="Showing only your own leads — clear that filter first."
              value={filters.uploaderId ?? "all"}
              onChange={(v) => applyFilters({ uploaderId: v === "all" ? undefined : v })}
              options={[
                { value: "all", label: "All uploaders" },
                ...uploaders.map((u) => ({ value: u.id, label: u.name })),
              ]}
            />
          )}
          {campaigns.length > 0 && (
            <SelectMenu
              label="Filter by campaign"
              size="sm"
              triggerClassName="h-9"
              value={filters.campaignId === "__none__" ? "none" : (filters.campaignId ?? "all")}
              onChange={(v) =>
                applyFilters({
                  campaignId: v === "all" ? undefined : v === "none" ? "__none__" : v,
                })
              }
              options={[
                { value: "all", label: "All campaigns" },
                { value: "none", label: "Unassigned" },
                ...campaigns.map((c) => ({ value: c.id, label: c.name })),
              ]}
            />
          )}
          {(orgGroups.length > 0 || leads.some((l) => l.leadGroup) || filters.group) && (
            <SelectMenu
              label="Filter by group"
              size="sm"
              triggerClassName="h-9"
              value={filters.group === "__misc__" ? "unsorted" : (filters.group ?? "all")}
              onChange={(v) =>
                applyFilters({
                  group: v === "all" ? undefined : v === "unsorted" ? "__misc__" : v,
                })
              }
              options={[
                { value: "all", label: "All groups" },
                { value: "unsorted", label: "Miscellaneous" },
                ...groupOptions.map((g) => ({ value: g.key, label: g.label })),
              ]}
            />
          )}
          {(countyOptions.length > 0 || filters.county) && (
            <SelectMenu
              label="Filter by county"
              size="sm"
              triggerClassName="h-9"
              value={filters.county === "__none__" ? "unsorted" : (filters.county ?? "all")}
              onChange={(v) =>
                applyFilters({
                  county: v === "all" ? undefined : v === "unsorted" ? "__none__" : v,
                })
              }
              options={[
                { value: "all", label: "All counties" },
                { value: "unsorted", label: "No county on file" },
                ...countyOptions.map((c) => ({ value: c.key, label: c.label })),
              ]}
            />
          )}
          {(cityOptions.length > 0 || filters.city) && (
            <SelectMenu
              label="Filter by city"
              size="sm"
              triggerClassName="h-9"
              value={filters.city === "__none__" ? "unsorted" : (filters.city ?? "all")}
              onChange={(v) =>
                applyFilters({
                  city: v === "all" ? undefined : v === "unsorted" ? "__none__" : v,
                })
              }
              options={[
                { value: "all", label: "All cities" },
                { value: "unsorted", label: "No city on file" },
                ...cityOptions.map((c) => ({ value: c.key, label: c.label })),
              ]}
            />
          )}
          {FILTERS.map((f) => {
            const active = (filters.status ?? "all") === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() =>
                  applyFilters({ status: f.value === "all" ? undefined : f.value })
                }
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

      {/* Active typed-filter summary — visible whenever ?f= is applied, so the
          filtered view is never mistaken for the whole book. */}
      {filters.f && filterSpec && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent-soft/40 px-3 py-2">
          <ListFilter className="h-4 w-4 text-accent" />
          <span className="text-sm font-medium">
            Filtered view — {activeConditionCount} condition
            {activeConditionCount === 1 ? "" : "s"}
            {filterSpec.groups.length > 1 &&
              ` across ${filterSpec.groups.length} groups`}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {/* Any active ?f= can become a named smart list — the whole point
                of the chips row being DB-backed. */}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={openSaveDialog}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              Save as list…
            </Button>
            <Button variant="outline" size="sm" onClick={openFilterBuilder}>
              Edit
            </Button>
            <button
              type="button"
              onClick={clearFilterSpec}
              className="text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              Clear filter
            </button>
          </div>
        </div>
      )}

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
              <SelectMenu
                label="Assign to campaign"
                placeholder="Choose…"
                size="sm"
                triggerClassName="h-8"
                value={assignTo || null}
                onChange={(v) => setAssignTo(v)}
                options={[
                  ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                  { value: "none", label: "Remove from campaign" },
                ]}
              />
              <Button size="sm" className="gap-1.5" disabled={!assignTo || busy} onClick={assign}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Apply
              </Button>
            </>
          )}
          {canManage && members.length > 0 && (
            <>
              <span className="text-sm text-muted-foreground">Reassign to</span>
              <SelectMenu
                label="Reassign selected leads to"
                placeholder="Choose teammate…"
                size="sm"
                triggerClassName="h-8"
                value={reassignTo || null}
                onChange={(v) => setReassignTo(v)}
                options={members.map((m) => ({
                  value: m.id,
                  label: m.id === meId ? "Me" : m.name || "Member",
                }))}
              />
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
              <SelectMenu
                label="Assign selected leads to a rep (keeps the uploader)"
                placeholder="Choose teammate…"
                size="sm"
                triggerClassName="h-8"
                value={assignRepTo || null}
                onChange={(v) => setAssignRepTo(v)}
                options={members.map((m) => ({
                  value: m.id,
                  label: m.id === meId ? "Me" : m.name || "Member",
                }))}
              />
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
          {/* Archive = curate without destroying. Managers+ only (the shared
              book); reps tidy their own uploads with Delete below. */}
          {canManage && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={busy}
              onClick={archiveSelected}
              title="Remove from the default views without deleting anything"
            >
              {busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Archive className="h-3.5 w-3.5" />
              )}
              Archive
            </Button>
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

      <div
        className={cn(
          "overflow-hidden rounded-2xl border border-border/60 surface-glass transition-opacity",
          isPending && "opacity-60",
        )}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: tableMinWidth }}>
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
                <SortableTh label={vocab.LeadNoun} sortKey="name" sort={activeSort} onToggle={toggleSort} />
                <SortableTh label="Location" sortKey="city" sort={activeSort} onToggle={toggleSort} />
                <th className="px-4 py-3">Campaign</th>
                {valueColumns.map((f) => {
                  const sortKey = f.source === "core" ? CORE_FIELD_SORTS[f.key] : undefined;
                  const numeric = f.type === "currency" || f.type === "number";
                  return sortKey ? (
                    <SortableTh
                      key={f.key}
                      label={f.label}
                      sortKey={sortKey}
                      numeric={numeric}
                      sort={activeSort}
                      onToggle={toggleSort}
                    />
                  ) : (
                    <th key={f.key} className={cn("px-4 py-3", numeric && "text-right")}>
                      {f.label}
                    </th>
                  );
                })}
                {flagFields.length > 0 && <th className="px-4 py-3">Profile</th>}
                <SortableTh label="Status" sortKey="status" sort={activeSort} onToggle={toggleSort} />
                <SortableTh label="AI" sortKey="ai_score" numeric sort={activeSort} onToggle={toggleSort} />
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
                    // Anywhere on the row opens Lead 360 — except clicks that
                    // land on a real control (checkbox, Call, Edit, Delete),
                    // which keep their own behavior.
                    onClick={(e) => {
                      if (
                        (e.target as HTMLElement).closest(
                          "button, a, input, select, label",
                        )
                      )
                        return;
                      lead360.open(l.id);
                    }}
                    className={cn("group cursor-pointer transition-colors hover:bg-muted/50", isSel && "bg-primary-soft/30")}
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
                        <Avatar initials={initials(name)} tone="chart-1" size="sm" />
                        <div className="min-w-0">
                          {/* Keyboard-reachable twin of the row click. */}
                          <button
                            type="button"
                            onClick={() => lead360.open(l.id)}
                            title="Open full record"
                            className="block max-w-full truncate rounded-sm text-left font-semibold hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {name || "—"}
                          </button>
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
                        {l.county && <p className="truncate text-xs">{l.county} County</p>}
                        {(l.utilityProvider || (showSolarPayment && l.solarProvider)) && (
                          <p className="truncate text-xs">
                            {[l.utilityProvider, showSolarPayment ? l.solarProvider : null]
                              .filter(Boolean)
                              .join(" · ")}
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
                            {groupLabelOf(l.leadGroup)}
                          </Badge>
                        )}
                        {!l.campaignId && !l.leadGroup && (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                    </td>
                    {valueColumns.map((f) => {
                      const numeric = f.type === "currency" || f.type === "number";
                      const text = formatFieldValue(leadFieldValue(l, f), f.type);
                      return (
                        <td
                          key={f.key}
                          className={cn(
                            "px-4 py-3",
                            numeric
                              ? "text-right font-semibold tabular"
                              : "text-muted-foreground",
                          )}
                        >
                          {numeric ? (
                            text
                          ) : (
                            <span className="block max-w-[180px] truncate" title={text}>
                              {text}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    {flagFields.length > 0 && (
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1 text-muted-foreground">
                          {flagFields
                            .filter((f) => leadFieldValue(l, f) === true)
                            .map((f) => {
                              const Icon = FLAG_ICONS[f.key];
                              return Icon ? (
                                <span key={f.key} title={f.label}>
                                  <Icon className="h-4 w-4" />
                                </span>
                              ) : (
                                <Badge key={f.key} tone="neutral">
                                  {f.label}
                                </Badge>
                              );
                            })}
                          {flagFields.every((f) => leadFieldValue(l, f) !== true) && (
                            <span className="text-xs">—</span>
                          )}
                        </div>
                      </td>
                    )}
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
                        {/* Deep-link into the dialer aimed at THIS number —
                            same ?dial=&name= contract the callbacks and
                            set-aside pages use. Bare /dialer just opened the
                            page and forgot who you meant to call. */}
                        <Link
                          href={dialDeepLink({ phone: l.phone, name })}
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
      {/* Server-side pagination — `total` counts every row matching the current
          filters, of which this page renders at most `pageSize`. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground tabular">
          {total === 0
            ? "0 leads"
            : `Showing ${formatNumber((page - 1) * pageSize + 1)}–${formatNumber(
                Math.min(page * pageSize, total),
              )} of ${formatNumber(total)} leads`}
        </p>
        {total > pageSize && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || isPending}
              onClick={() => goToPage(page - 1)}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground tabular">
              Page {formatNumber(page)} of {formatNumber(Math.max(1, Math.ceil(total / pageSize)))}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= Math.ceil(total / pageSize) || isPending}
              onClick={() => goToPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>

      {editing && (
        <EditLeadDialog
          lead={editing}
          onClose={() => setEditing(null)}
          showSolarPayment={showSolarPayment}
          fields={fields}
        />
      )}

      {/* "Save as list…" — names the ACTIVE ?f= filter and stores it as a
          smart_lists row. Rendered always so the exit animation plays. */}
      <Modal
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        labelledBy="save-list-title"
        maxWidth="max-w-md"
        dismissible={!saveBusy}
      >
        <div className="border-b border-border/60 p-5">
          <h2
            id="save-list-title"
            className="flex items-center gap-2 text-lg font-bold tracking-tight"
          >
            <BookmarkPlus className="h-4 w-4" />
            Save as list
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            A smart list keeps this filter one click away and always shows
            whichever {vocab.leadNounPlural} match right now.
          </p>
        </div>
        <form
          className="space-y-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            void saveAsList();
          }}
        >
          <div>
            <Label htmlFor="save-list-name">Name</Label>
            <Input
              id="save-list-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              maxLength={80}
              required
              placeholder="e.g. Going cold in Fresno"
            />
          </div>
          <div>
            <Label htmlFor="save-list-desc">Description (optional)</Label>
            <Input
              id="save-list-desc"
              value={saveDesc}
              onChange={(e) => setSaveDesc(e.target.value)}
              maxLength={300}
              placeholder="What this list is for"
            />
          </div>
          {/* Sharing needs leads.import — a rep's lists are private, so the
              toggle only renders where the API would accept it. */}
          {canManage && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={saveShared}
                onChange={(e) => setSaveShared(e.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Share with the whole workspace
            </label>
          )}
          {saveErr && <p className="text-sm font-medium text-danger">{saveErr}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSaveOpen(false)}
              disabled={saveBusy}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              className="gap-1.5"
              disabled={saveBusy || !saveName.trim()}
            >
              {saveBusy && (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
              )}
              Save list
            </Button>
          </div>
        </form>
      </Modal>

      {/* The typed-filter builder drawer. Rendered always (open drives the
          exit animation); Apply pushes ?f= into the URL, Cancel discards the
          draft — the page's spec is untouched until Apply. */}
      <Drawer
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        label="Filter leads"
        width={640}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              <ListFilter className="h-4 w-4" />
              Filters
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Match {vocab.leadNounPlural} on any field, with AND/OR groups.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setFiltersOpen(false)}>
            Cancel
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <FilterBuilder
            value={draftSpec}
            onChange={setDraftSpec}
            fields={fields}
            statusOptions={statusOptions}
            campaignOptions={campaigns}
            repOptions={members}
          />
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border/60 p-4">
          {filters.f && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFiltersOpen(false);
                clearFilterSpec();
              }}
            >
              Clear filter
            </Button>
          )}
          <Button size="sm" onClick={applyFilterSpec} disabled={isPending}>
            {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Apply
          </Button>
        </div>
      </Drawer>
    </div>
  );
}
