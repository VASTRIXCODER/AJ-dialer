"use client";

import { ClipboardList, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssignmentRecord } from "@/lib/db/assignments";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import { AllocateWizard } from "./allocate-wizard";
import { AssignmentDetailDrawer } from "./assignment-detail";
import { AssignmentTable, ProgressLegend } from "./assignment-table";

// ─────────────────────────────────────────────────────────────────────────────
// Assignment Center — the manager's side. The table ships server-rendered
// (initialAssignments); every mutation refetches through the same GET the
// server used, so the page and its refreshes can never disagree.
// ─────────────────────────────────────────────────────────────────────────────

export function AssignmentCenter({
  initialAssignments,
  members,
  campaigns,
  smartLists,
  fields,
}: {
  initialAssignments: AssignmentRecord[];
  members: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  smartLists: { id: string; name: string }[];
  fields: LeadFieldDef[];
}) {
  const vocab = useVocabulary();
  const router = useRouter();
  const [assignments, setAssignments] = useState(initialAssignments);
  const [refreshing, setRefreshing] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/assignments", { cache: "no-store" });
      const json = (await res.json().catch(() => ({}))) as {
        assignments?: AssignmentRecord[];
      };
      if (res.ok && Array.isArray(json.assignments)) setAssignments(json.assignments);
    } catch {
      /* keep the current table rather than blanking it on a hiccup */
    } finally {
      setRefreshing(false);
    }
    router.refresh();
  }, [router]);

  const shown = showArchived
    ? assignments
    : assignments.filter((a) => a.status !== "archived");
  const archivedCount = assignments.length - shown.length;

  return (
    <>
      <PageHeader
        title="Assignments"
        description={`Deal ${vocab.leadNounPlural} out as real assignments — with owners, due dates, and live progress.`}
      >
        <Button size="sm" className="gap-1.5" onClick={() => setWizardOpen(true)}>
          <Plus className="h-4 w-4" />
          Allocate leads
        </Button>
      </PageHeader>

      {assignments.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No assignments yet"
          description={`Allocate a slice of the unassigned pool — or a smart list, or a custom filter — to a rep, and track how far they get right here.`}
        />
      ) : (
        <SectionCard
          title="All assignments"
          description={`${shown.length} shown · progress counts live from each assignment's ${vocab.leadNounPlural}`}
          bodyClassName="p-0"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-border/60 px-5 py-3">
            <ProgressLegend />
            <div className="ml-auto flex items-center gap-3">
              {archivedCount > 0 || showArchived ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={showArchived}
                    onChange={(e) => setShowArchived(e.target.checked)}
                    className="h-[22px] w-[22px] rounded border-input accent-primary"
                  />
                  Show archived{archivedCount > 0 ? ` (${archivedCount})` : ""}
                </label>
              ) : null}
              <button
                type="button"
                onClick={() => void refresh()}
                disabled={refreshing}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                <RotateCcw className={cn("h-3 w-3", refreshing && "animate-spin")} />
                Refresh
              </button>
            </div>
          </div>
          {shown.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">
              Everything here is archived — tick “Show archived” to see it.
            </p>
          ) : (
            <AssignmentTable assignments={shown} onSelect={setDetailId} />
          )}
        </SectionCard>
      )}

      <AllocateWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onDone={() => void refresh()}
        members={members}
        campaigns={campaigns}
        smartLists={smartLists}
        fields={fields}
      />

      <AssignmentDetailDrawer
        id={detailId}
        members={members}
        onClose={() => setDetailId(null)}
        onChanged={() => void refresh()}
      />
    </>
  );
}
