"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  MessageSquare,
  PlugZap,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Menu, MenuItem, MenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toast";
import { useLead360 } from "@/components/leads/lead-360/lead-360-provider";
import { cn, formatPhone, relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// The approvals inbox — the human in "the engine proposes, a named human sends".
//
// Two panes: what is waiting on the left, the exact words on the right. The
// right pane shows the message VERBATIM, because that is the thing being
// approved. Summarising it, or showing the template instead of the rendered
// body, would mean the approver approved something other than what goes out.
//
// Bulk approval is available and fenced: homogeneous batches only, a stated
// count, and the reject action lives in an overflow menu rather than next to
// Approve. Esc is never bound to reject.
// ─────────────────────────────────────────────────────────────────────────────

export interface ApprovalCard {
  id: string;
  leadId: string | null;
  leadName: string;
  toNumber: string | null;
  body: string;
  templateKey: string | null;
  authorName: string;
  /**
   * True when the viewer wrote this themselves. A rep may self-approve their
   * own 1:1 but not what the automation proposed, so the two need telling
   * apart on screen — offering a button that 403s teaches people to distrust
   * every button.
   */
  isOwn: boolean;
  scope: string;
  segments: number | null;
  createdAt: string;
}

export function Approvals({
  approvals,
  total,
  canApprove,
  canApproveAutomation,
  canBulk,
  messagingReady,
  messagingReason,
}: {
  approvals: ApprovalCard[];
  total: number;
  canApprove: boolean;
  /** False for a rep: they may only approve what they wrote themselves. */
  canApproveAutomation: boolean;
  canBulk: boolean;
  /** False when the channel isn't wired. The queue then explains itself. */
  messagingReady: boolean;
  messagingReason: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const lead360 = useLead360();
  const [selectedId, setSelectedId] = useState<string | null>(approvals[0]?.id ?? null);
  const [busy, setBusy] = useState(false);

  const selected = approvals.find((a) => a.id === selectedId) ?? approvals[0] ?? null;

  // Homogeneous only: same template, or all untemplated. Approving a mixed bag
  // in one click means approving wording nobody looked at.
  const templateKeys = [...new Set(approvals.map((a) => a.templateKey ?? ""))];
  const homogeneous = templateKeys.length === 1;
  // What a bulk approve would actually be allowed to touch.
  const bulkable = canApproveAutomation ? approvals : approvals.filter((a) => a.isOwn);

  async function decide(ids: string[], action: "approve" | "reject") {
    setBusy(true);
    try {
      const res = await fetch("/api/messages/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        decided?: number;
        requested?: number;
        error?: string;
      };
      if (!res.ok) {
        toast({ title: j.error ?? "That didn't go through.", tone: "danger" });
        return;
      }
      const decided = j.decided ?? 0;
      const requested = j.requested ?? ids.length;
      toast({
        title:
          action === "approve"
            ? `${decided} approved`
            : `${decided} rejected`,
        // Never imply the whole batch landed when it did not.
        description:
          decided < requested
            ? `${requested - decided} had already been decided or cancelled.`
            : action === "approve"
              ? "They'll go out on the next send, subject to a final check."
              : undefined,
        tone: decided > 0 ? "success" : "default",
      });
      setSelectedId(null);
      router.refresh();
    } catch {
      toast({ title: "That didn't go through.", tone: "danger" });
    } finally {
      setBusy(false);
    }
  }

  if (!messagingReady) {
    // No simulated messaging. If the channel isn't wired, this stays dark and
    // says why, rather than showing a queue that could never drain.
    return (
      <EmptyState
        icon={PlugZap}
        title="Messaging isn't connected"
        description={messagingReason}
      />
    );
  }

  if (approvals.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle2}
        title="Nothing waiting for approval"
        description="When a playbook proposes a message, it appears here for someone to read before it goes. Nothing is ever sent without that."
      />
    );
  }

  return (
    <SectionCard
      title={`Waiting for approval · ${total}`}
      description="Nothing here has been sent. Read the message, then approve or reject it."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!canApprove || !canBulk || !homogeneous || busy || bulkable.length === 0}
          title={
            !canApprove
              ? "You don't have permission to approve messages."
              : !canBulk
                ? "Approving a batch at once needs the bulk permission."
                : bulkable.length === 0
                  ? "These were all proposed by the automation, so they need a manager to read them."
                  : !homogeneous
                    ? "These use different templates. Approve them individually so each wording is actually read."
                    : undefined
          }
          onClick={() => void decide(bulkable.map((a) => a.id), "approve")}
        >
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Check className="mr-1.5 h-4 w-4" />
          )}
          Approve all {bulkable.length}
        </Button>
        {!homogeneous && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            {templateKeys.length} different templates in this queue
          </span>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,20rem)_1fr]">
        {/* Left: who is waiting. */}
        <ul className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
          {approvals.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => setSelectedId(a.id)}
                className={cn(
                  "w-full rounded-xl border p-2.5 text-left transition-colors",
                  a.id === selected?.id
                    ? "border-primary/50 bg-primary-soft/30"
                    : "border-border/70 bg-card hover:bg-muted/50",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                    {a.leadName}
                  </span>
                  {a.scope === "promotional" && <Badge tone="warning">Offer</Badge>}
                </span>
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {a.authorName} · {relativeTime(a.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {/* Right: the exact words. */}
        {selected && (
          <div className="rounded-xl border border-border/70 bg-card p-3">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => selected.leadId && lead360.open(selected.leadId)}
                  disabled={!selected.leadId}
                  className="text-sm font-semibold hover:text-primary disabled:hover:text-foreground"
                >
                  {selected.leadName}
                </button>
                {selected.toNumber && (
                  <p className="text-xs tabular text-muted-foreground">
                    {formatPhone(selected.toNumber)}
                  </p>
                )}
              </div>
              <Menu>
                <MenuTrigger
                  label="Other actions"
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-muted/70"
                >
                  More
                </MenuTrigger>
                {/* Reject lives here, not beside Approve. A destructive action
                    adjacent to a constructive one is a mis-click waiting to
                    happen, and this queue is worked fast. */}
                <MenuItem danger icon={X} onSelect={() => void decide([selected.id], "reject")}>
                  Reject this message
                </MenuItem>
              </Menu>
            </div>

            {/* The message, verbatim. This is the thing being approved. */}
            <div className="mt-2.5 rounded-xl bg-muted/40 p-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{selected.body}</p>
            </div>

            <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              {selected.segments ? `${selected.segments} segment${selected.segments === 1 ? "" : "s"}` : "1 segment"}
              {selected.templateKey && <span>· {selected.templateKey.replace(/_/g, " ")}</span>}
              <span>· proposed {relativeTime(selected.createdAt)}</span>
            </p>

            <div className="mt-3">
              <Button
                size="sm"
                disabled={!canApprove || busy || (!canApproveAutomation && !selected.isOwn)}
                title={
                  !canApprove
                    ? "You don't have permission to approve messages."
                    : !canApproveAutomation && !selected.isOwn
                      ? "The automation proposed this one, so it needs a manager to read it. You can approve messages you wrote yourself."
                      : undefined
                }
                onClick={() => void decide([selected.id], "approve")}
              >
                <Check className="mr-1.5 h-4 w-4" />
                Approve and send
              </Button>
            </div>
          </div>
        )}
      </div>

      {total > approvals.length && (
        <p className="mt-2 text-xs text-muted-foreground">
          Showing the {approvals.length} oldest of {total}.
        </p>
      )}
    </SectionCard>
  );
}
