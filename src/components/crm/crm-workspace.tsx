"use client";

import { Droplets, Inbox, KanbanSquare, Layers, Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectMenu, type SelectOption } from "@/components/ui/select-menu";
import { Tab, TabList, TabPanel, Tabs } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import type { CrmBoard, CrmQueue } from "@/lib/db/crm";
import { UNASSIGNED } from "@/lib/opportunities/board";
import { Audiences } from "./audiences";
import { PipelineBoard } from "./pipeline-board";
import { WorkQueue } from "./work-queue";

export interface AudienceCard {
  id: string;
  name: string;
  description: string;
  tone: string;
  favorite: boolean;
  shared: boolean;
  /** How many conditions the audience tests — "what does this actually select". */
  conditions: number;
  warnings: string[];
  /** Null when the filter can't be encoded; the surface then offers no link. */
  href: string | null;
}

const VIEWS = ["pipeline", "queue", "audiences"] as const;
type View = (typeof VIEWS)[number];

function isView(v: string | null): v is View {
  return v != null && (VIEWS as readonly string[]).includes(v);
}

/**
 * Write ?view= WITHOUT a router navigation.
 *
 * Copied deliberately from writeLeadParam in lead-360-provider: Next syncs a
 * replaceState into useSearchParams with no RSC refetch, so switching views
 * never re-renders the server tree. That matters here for the same reason it
 * matters there — the Lead 360 drawer opens over this page, and a router
 * navigation would tear it down mid-read. Passing window.history.state as the
 * first argument is load-bearing: replacing it with null breaks back/forward.
 */
function writeViewParam(view: View) {
  const url = new URL(window.location.href);
  if (view === "pipeline") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  window.history.replaceState(window.history.state, "", url.toString());
}

export function CrmWorkspace({
  board,
  queue,
  audiences,
  canManagePipeline,
  canClaim,
  canOpenLeads,
  owners,
  appointmentNoun,
  leadNoun,
  leadNounPlural,
}: {
  board: CrmBoard | null;
  queue: CrmQueue | null;
  audiences: AudienceCard[];
  canManagePipeline: boolean;
  canClaim: boolean;
  canOpenLeads: boolean;
  /** Empty for a rep — their board is their own book and cannot be widened. */
  owners: { id: string; name: string }[];
  appointmentNoun: string;
  leadNoun: string;
  leadNounPlural: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const urlView = params.get("view");
  // URL wins over the default, so a shared link opens the view the sender was
  // looking at.
  const [view, setView] = useState<View>(isView(urlView) ? urlView : "pipeline");
  const [claiming, setClaiming] = useState(false);

  // A back/forward press changes the URL without remounting; follow it.
  useEffect(() => {
    if (isView(urlView) && urlView !== view) setView(urlView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlView]);

  const changeView = useCallback((next: string) => {
    if (!isView(next)) return;
    setView(next);
    writeViewParam(next);
  }, []);

  const claimable = queue?.claimable ?? 0;
  const leaks = board?.leakCount ?? 0;

  const claim = useCallback(async () => {
    setClaiming(true);
    try {
      const res = await fetch("/api/crm/claim", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 5 }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        claimed?: number;
        requested?: number;
        error?: string;
      };
      if (!res.ok) {
        toast({ title: j.error ?? "Couldn't claim right now.", tone: "danger" });
        return;
      }
      const got = j.claimed ?? 0;
      if (got === 0) {
        // Not an error: somebody else got there first. Say which it was.
        toast({
          title: "Nothing left to claim",
          description: "Another rep took the last of it. The queue refreshed.",
        });
      } else {
        toast({
          title: `Claimed ${got}`,
          // Never imply the full request landed when it didn't.
          description:
            got < (j.requested ?? 5)
              ? `Only ${got} were still free. They're yours for the next 5 minutes.`
              : "Yours for the next 5 minutes.",
          tone: "success",
        });
      }
      changeView("queue");
      router.refresh();
    } catch {
      toast({ title: "Couldn't claim right now.", tone: "danger" });
    } finally {
      setClaiming(false);
    }
  }, [changeView, router, toast]);

  // Changing WHOSE pipeline you're looking at changes every count on the
  // board, so unlike the view switch it is a real navigation: push, so the
  // server re-queries and Back returns to the previous owner.
  const setOwner = useCallback(
    (next: string) => {
      const url = new URL(window.location.href);
      if (next === "all") url.searchParams.delete("owner");
      else url.searchParams.set("owner", next);
      router.push(`${url.pathname}${url.search}`, { scroll: false });
    },
    [router],
  );

  const ownerOptions: SelectOption[] = [
    { value: "all", label: "Everyone", hint: "The whole org's pipeline" },
    { value: UNASSIGNED, label: "Unassigned", hint: "Records nobody owns yet" },
    ...owners.map((o) => ({ value: o.id, label: o.name })),
  ];

  // ONE primary action, resolved by a ladder. When nothing is waiting there is
  // no button at all — a disabled primary with nothing behind it is furniture.
  const primary =
    canClaim && claimable > 0 ? (
      <Button size="sm" onClick={claim} disabled={claiming}>
        {claiming ? (
          <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <Inbox className="mr-1.5 h-4 w-4" />
        )}
        Claim 5 of {claimable}
      </Button>
    ) : leaks > 0 ? (
      <Button size="sm" variant="secondary" onClick={() => changeView("pipeline")}>
        <Droplets className="mr-1.5 h-4 w-4" />
        {leaks} stalled
      </Button>
    ) : null;

  return (
    // One Tabs context around both the strip and the panels — the list's
    // aria-controls has to name a panel id from the same instance, and each
    // Tabs generates its own id base.
    <Tabs value={view} onChange={changeView} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabList label="CRM views">
          <Tab value="pipeline">
            <span className="flex items-center gap-1.5">
              <KanbanSquare className="h-3.5 w-3.5" /> Pipeline
            </span>
          </Tab>
          <Tab value="queue">
            <span className="flex items-center gap-1.5">
              <Inbox className="h-3.5 w-3.5" /> Queue
            </span>
          </Tab>
          <Tab value="audiences">
            <span className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Audiences
            </span>
          </Tab>
        </TabList>
        <div className="flex flex-wrap items-center gap-2">
          {/* Only on the board — the queue is org-wide by nature and audiences
              aren't owned, so the control would be inert on both. */}
          {view === "pipeline" && owners.length > 0 && (
            <SelectMenu
              label="Filter the pipeline by owner"
              size="sm"
              value={board?.ownerFilter ?? "all"}
              onChange={setOwner}
              options={ownerOptions}
            />
          )}
          {primary}
        </div>
      </div>

      {/* Panels stay mounted (TabPanel only toggles `hidden`), which is safe
          here because none of the three fetches on mount — they are all fed
          server-assembled props, like every other panel in the product. */}
      <TabPanel value="pipeline">
        <PipelineBoard
          board={board}
          canManage={canManagePipeline}
          ownerName={
            board?.ownerFilter
              ? board.ownerFilter === UNASSIGNED
                ? "Unassigned"
                : (owners.find((o) => o.id === board.ownerFilter)?.name ?? "One rep")
              : null
          }
          appointmentNoun={appointmentNoun}
          leadNoun={leadNoun}
          leadNounPlural={leadNounPlural}
        />
      </TabPanel>
      <TabPanel value="queue">
        <WorkQueue queue={queue} canClaim={canClaim} leadNounPlural={leadNounPlural} />
      </TabPanel>
      <TabPanel value="audiences">
        <Audiences
          audiences={audiences}
          canOpenLeads={canOpenLeads}
          leadNounPlural={leadNounPlural}
        />
      </TabPanel>
    </Tabs>
  );
}
