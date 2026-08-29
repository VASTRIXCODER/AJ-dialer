"use client";

import { AlertTriangle, ExternalLink, Lock, Pencil, SearchX, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { EditLeadDialog } from "@/components/leads/edit-lead-dialog";
import { useVocabulary } from "@/components/layout/vocabulary";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import type { LeadPanel } from "@/lib/db/lead-360";
import type { TimelineItem } from "@/lib/db/lead-timeline";
import { resolveLeadStatusConfig } from "@/lib/status";
import { useVisiblePoll } from "@/lib/use-visible-poll";
import { formatPhone } from "@/lib/utils";
import { Lead360Content } from "./lead-360-content";

// ─────────────────────────────────────────────────────────────────────────────
// The Lead 360 drawer — the canonical lead record, openable over any screen.
// Fetches /api/leads/[id]/panel, keeps itself fresh with a gentle 20s poll
// (paused while the tab is hidden — useVisiblePoll) plus a refetch on window
// focus, and renders the same <Lead360Content> the /leads/[id] page uses.
// ─────────────────────────────────────────────────────────────────────────────

type FetchState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "denied" }
  | { status: "missing" }
  | { status: "ready"; panel: LeadPanel; timeline: TimelineItem[] };

export function Lead360Drawer({
  leadId,
  onClose,
}: {
  leadId: string | null;
  onClose: () => void;
}) {
  // The body (with its fetch + poll hooks) mounts only while a lead is open,
  // so nothing polls behind a closed drawer.
  if (!leadId) return null;
  return <Lead360DrawerBody key={leadId} leadId={leadId} onClose={onClose} />;
}

function Lead360DrawerBody({
  leadId,
  onClose,
}: {
  leadId: string;
  onClose: () => void;
}) {
  const vocab = useVocabulary();
  const headingId = useId();
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [editing, setEditing] = useState(false);
  // Quiet refreshes keep the current panel on screen instead of flashing the
  // skeleton; only the very first load (or a retry) shows it.
  const hasData = useRef(false);

  const load = useCallback(
    async (quiet: boolean) => {
      if (!quiet) setState({ status: "loading" });
      try {
        const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/panel`, {
          cache: "no-store",
        });
        if (res.status === 401 || res.status === 403) {
          setState({ status: "denied" });
          return;
        }
        if (res.status === 404) {
          setState({ status: "missing" });
          return;
        }
        if (!res.ok) {
          if (!hasData.current) setState({ status: "error" });
          return;
        }
        const json = (await res.json()) as {
          panel?: LeadPanel;
          timeline?: TimelineItem[];
        };
        if (!json.panel) {
          setState({ status: "error" });
          return;
        }
        hasData.current = true;
        setState({ status: "ready", panel: json.panel, timeline: json.timeline ?? [] });
      } catch {
        if (!hasData.current) setState({ status: "error" });
      }
    },
    [leadId],
  );

  // Initial load + gentle 20s keep-fresh poll while the drawer is open and the
  // tab is visible. useVisiblePoll fires immediately on mount, so no separate
  // initial fetch is needed.
  useVisiblePoll(() => void load(hasData.current), 20_000);

  // Refetch when the window regains focus (the rep alt-tabbed back).
  useEffect(() => {
    const onFocus = () => void load(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [load]);

  const panel = state.status === "ready" ? state.panel : null;
  const statusConfig = resolveLeadStatusConfig(vocab);
  const name = panel
    ? `${panel.lead.firstName} ${panel.lead.lastName}`.trim() ||
      formatPhone(panel.lead.phone)
    : "Lead";

  return (
    <Drawer onClose={onClose} labelledBy={headingId} width={720} dismissible={!editing}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={headingId} className="truncate text-lg font-bold tracking-tight">
              {name}
            </h2>
            {panel && (
              <Badge tone={statusConfig[panel.lead.status].tone}>
                {statusConfig[panel.lead.status].label}
              </Badge>
            )}
          </div>
          {panel && panel.lead.phone && (
            <a
              href={`tel:${panel.lead.phone}`}
              className="mt-0.5 inline-block text-sm text-muted-foreground tabular hover:text-foreground"
            >
              {formatPhone(panel.lead.phone)}
            </a>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {panel && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => setEditing(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
          )}
          <Link
            href={`/leads/${encodeURIComponent(leadId)}`}
            className={buttonVariants({ variant: "outline", size: "sm", className: "gap-1.5" })}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open full page
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5">
        {state.status === "loading" && <PanelSkeleton />}

        {state.status === "error" && (
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5" />}
            title="Couldn't load this record"
            detail="Something went wrong fetching the details."
          >
            <Button variant="outline" size="sm" onClick={() => void load(false)}>
              Try again
            </Button>
          </EmptyState>
        )}

        {state.status === "denied" && (
          <EmptyState
            icon={<Lock className="h-5 w-5" />}
            title={`This ${vocab.leadNoun} isn't in your book`}
            detail="It belongs to a teammate — ask a manager to assign it to you."
          />
        )}

        {state.status === "missing" && (
          <EmptyState
            icon={<SearchX className="h-5 w-5" />}
            title={`${vocab.LeadNoun} not found`}
            detail="It may have been deleted, or the link is out of date."
          />
        )}

        {state.status === "ready" && (
          <Lead360Content
            panel={state.panel}
            timeline={state.timeline}
            onRefresh={() => void load(true)}
          />
        )}
      </div>

      {editing && panel && (
        <EditLeadDialog
          lead={panel.lead}
          fields={panel.fields.map((f) => f.def)}
          showSolarPayment={panel.fields.some(
            (f) => f.def.key === "solarPayment" || f.def.key === "solarProvider",
          )}
          onClose={() => {
            setEditing(false);
            void load(true);
          }}
        />
      )}
    </Drawer>
  );
}

function PanelSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span role="status" className="sr-only">
        Loading…
      </span>
      {[36, 120, 88, 160].map((h, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl bg-muted"
          style={{ height: h }}
        />
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {icon}
      </span>
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
      </div>
      {children}
    </div>
  );
}
