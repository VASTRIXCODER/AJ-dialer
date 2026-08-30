"use client";

import { CheckCircle2, Inbox, Loader2, PhoneCall, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { useLead360 } from "@/components/leads/lead-360/lead-360-provider";
import { dialDeepLink } from "@/lib/dialer/deep-link";
import type { CrmQueue, QueueItem } from "@/lib/db/crm";
import { workReasonLabel, workTypeLabel } from "@/lib/opportunities/event-copy";
import { formatPhone, relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The shared queue — work nobody is holding right now.
//
// This is the only surface that can hand you work that isn't yours yet.
// /today is fenced to what you already own by design, and /command is
// read-only. That gap is the reason this view exists.
//
// The lease countdown is shown, not hidden. A claim expires after five minutes
// and the item returns to the pool; a rep who watched work silently vanish
// would reasonably conclude the product lost it.
// ─────────────────────────────────────────────────────────────────────────────

export function WorkQueue({
  queue,
  canClaim,
  leadNounPlural,
}: {
  queue: CrmQueue | null;
  canClaim: boolean;
  leadNounPlural: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const lead360 = useLead360();
  const [busy, setBusy] = useState(false);
  // Ticks once a second ONLY to redraw lease countdowns, and only while this
  // view has something leased. No fetching — the clock is local.
  const [, setTick] = useState(0);
  // Rows this rep is holding right now. The list deliberately carries these
  // alongside the free pool — claiming something used to make it vanish from
  // the screen, which is exactly the confusion the visible lease exists to
  // prevent.
  const held = queue?.items.filter((i) => i.reservedByMe && i.reservedUntil) ?? [];
  const heldIds = new Set(held.map((h) => h.id));
  const claimableShown = (queue?.items ?? []).filter((i) => !heldIds.has(i.id)).length;
  // The moment the last lease on screen runs out. A number, so it is a stable
  // effect dependency where the `held` array is not.
  const lastExpiry = held.reduce(
    (max, h) => Math.max(max, Date.parse(h.reservedUntil ?? "") || 0),
    0,
  );

  useEffect(() => {
    // Stops on its own. Keying the interval to "are any leases present" meant
    // it never stopped: the props it read are server-rendered and do not change
    // when a lease expires, so it re-rendered the whole table once a second
    // forever — behind a hidden CRM tab and a backgrounded browser tab alike.
    if (!lastExpiry || lastExpiry <= Date.now()) return;
    const t = setInterval(() => {
      setTick((n) => n + 1);
      if (Date.now() >= lastExpiry) clearInterval(t);
    }, 1000);
    return () => clearInterval(t);
  }, [lastExpiry]);

  if (!queue) {
    return (
      <EmptyState
        icon={Inbox}
        title="The queue isn't available right now"
        description="The shared queue couldn't be read. Reload the page; if it keeps happening, the workspace database may be unreachable."
      />
    );
  }

  async function post(url: string, body: unknown, verb: string) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as {
        claimed?: number;
        released?: number;
        requested?: number;
        error?: string;
      };
      if (!res.ok) {
        toast({ title: j.error ?? `Couldn't ${verb} right now.`, tone: "danger" });
        return;
      }
      if (typeof j.claimed === "number") {
        toast(
          j.claimed === 0
            ? {
                title: "Nothing left to claim",
                description: "Another rep took the last of it.",
              }
            : {
                title: `Claimed ${j.claimed}`,
                description:
                  j.claimed < (j.requested ?? j.claimed)
                    ? `Only ${j.claimed} were still free.`
                    : "Yours for the next 5 minutes.",
                tone: "success",
              },
        );
      } else if (typeof j.released === "number") {
        toast({
          title: `Released ${j.released}`,
          description: "Back in the shared queue for anyone to pick up.",
        });
      }
      router.refresh();
    } catch {
      toast({ title: `Couldn't ${verb} right now.`, tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  const columns: DataTableColumn<QueueItem>[] = [
    {
      key: "lead",
      header: "Contact",
      render: (r) => (
        <button
          type="button"
          onClick={() => r.leadId && lead360.open(r.leadId)}
          disabled={!r.leadId}
          title={r.leadId ? undefined : "This task has no linked contact."}
          className="text-left font-medium hover:text-primary disabled:cursor-not-allowed disabled:hover:text-foreground"
        >
          <span className="block truncate">{r.leadName}</span>
          {r.phone && (
            <span className="block truncate text-xs tabular text-muted-foreground">
              {formatPhone(r.phone)}
            </span>
          )}
        </button>
      ),
    },
    {
      key: "type",
      header: "Work",
      render: (r) => (
        <span>
          <span className="block font-medium">{workTypeLabel(r.type)}</span>
          {r.reason && (
            <span className="block truncate text-xs text-muted-foreground">
              {workReasonLabel(r.reason)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: "due",
      header: "Due",
      render: (r) => (
        <span className="text-xs tabular text-muted-foreground">
          {r.dueAt ? relativeTime(r.dueAt) : "anytime"}
        </span>
      ),
    },
    {
      key: "state",
      header: "State",
      align: "right",
      render: (r) =>
        r.reservedByMe && r.reservedUntil ? (
          <Badge tone="primary" className="tabular">
            Yours · {leaseLeft(r.reservedUntil)}
          </Badge>
        ) : (
          <Badge tone="neutral">Free</Badge>
        ),
    },
    {
      key: "act",
      header: "",
      align: "right",
      render: (r) =>
        r.reservedByMe && r.phone ? (
          <a
            href={dialDeepLink({ phone: r.phone, name: r.leadName })}
            className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
          >
            <PhoneCall className="h-3 w-3" /> Call
          </a>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <SectionCard
        title={`Shared queue · ${queue.claimable.toLocaleString()} claimable`}
        description={`Work nobody is holding right now · whole org · ${queue.held} held by you. A claim lasts 5 minutes, then returns to the pool.`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            disabled={!canClaim || busy || queue.claimable === 0}
            title={
              !canClaim
                ? "You don't have permission to claim shared work."
                : queue.claimable === 0
                  ? "There is nothing in the shared queue to claim."
                  : undefined
            }
            onClick={() => void post("/api/crm/claim", { count: 5 }, "claim")}
          >
            {busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Inbox className="mr-1.5 h-4 w-4" />
            )}
            Claim 5
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canClaim || busy || queue.held === 0}
            title={queue.held === 0 ? "You aren't holding any work." : undefined}
            onClick={() => void post("/api/crm/release", {}, "release")}
          >
            <Undo2 className="mr-1.5 h-4 w-4" />
            Release {queue.held > 0 ? queue.held : ""}
          </Button>
        </div>

        <DataTable
          columns={columns}
          rows={queue.items}
          rowKey={(r) => r.id}
          density="comfortable"
          empty={
            <EmptyState
              icon={CheckCircle2}
              title="The shared queue is empty"
              description={`Nothing is waiting to be picked up. Playbooks create work here as ${leadNounPlural} go unworked, so this filling up is the system noticing before you do.`}
            />
          }
        />
        {queue.claimable > claimableShown && (
          // Counts the CLAIMABLE rows on screen, not every row: the list also
          // carries what this rep is already holding, and folding those into
          // "showing N of M" would overstate how much of the free pool is
          // visible.
          <p className="mt-2 text-xs text-muted-foreground">
            Showing the {claimableShown} highest-priority of{" "}
            {queue.claimable.toLocaleString()} claimable
            {held.length > 0 ? `, plus the ${held.length} you're holding` : ""}.
          </p>
        )}
      </SectionCard>
    </div>
  );
}

/** Whole seconds left on a lease, or "expiring" once it has run out. */
function leaseLeft(until: string): string {
  const ms = Date.parse(until) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expiring";
  const secs = Math.round(ms / 1000);
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}
