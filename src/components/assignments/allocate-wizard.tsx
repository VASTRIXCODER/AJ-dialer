"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  ListFilter,
  Loader2,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useVocabulary } from "@/components/layout/vocabulary";
import { FilterBuilder } from "@/components/leads/filter-builder";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { AllocationPreview } from "@/lib/db/assignments";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import type { FilterSpec } from "@/lib/leads/filter-spec";
import { resolveLeadStatusConfig } from "@/lib/status";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Allocate wizard — source → rep & size → policy & review → commit.
//
// The preview numbers come from /api/assignments/preview, which resolves the
// source EXACTLY the way the commit will (same candidate-id chain), so what
// the manager reads and what actually allocates can never disagree.
// ─────────────────────────────────────────────────────────────────────────────

type SourceKind = "pool" | "smart_list" | "filter";

const STEPS = ["Source", "Rep & size", "Policy & review"] as const;

export function AllocateWizard({
  open,
  onClose,
  onDone,
  members,
  campaigns,
  smartLists,
  fields,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful commit so the center refreshes its table. */
  onDone: () => void;
  members: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  smartLists: { id: string; name: string }[];
  fields: LeadFieldDef[];
}) {
  const vocab = useVocabulary();
  const { toast } = useToast();

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<SourceKind>("pool");
  const [smartListId, setSmartListId] = useState("");
  const [filter, setFilter] = useState<FilterSpec | null>(null);
  const [repId, setRepId] = useState("");
  const [count, setCount] = useState(100);
  const [label, setLabel] = useState("");
  const [priority, setPriority] = useState(0);
  const [dueDate, setDueDate] = useState("");
  const [dialingMode, setDialingMode] = useState<"manual" | "ai" | "either">("either");
  const [maxAttempts, setMaxAttempts] = useState("");
  const [cooldownHours, setCooldownHours] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [preview, setPreview] = useState<AllocationPreview | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitErr, setCommitErr] = useState("");

  // Reset per open, so yesterday's half-built allocation never leaks in.
  useEffect(() => {
    if (!open) return;
    setStep(0);
    setKind("pool");
    setSmartListId("");
    setFilter(null);
    setRepId("");
    setCount(100);
    setLabel("");
    setPriority(0);
    setDueDate("");
    setDialingMode("either");
    setMaxAttempts("");
    setCooldownHours("");
    setCampaignId("");
    setPreview(null);
    setPreviewErr("");
    setCommitErr("");
  }, [open]);

  const statusOptions = useMemo(() => {
    const cfg = resolveLeadStatusConfig(vocab);
    return Object.entries(cfg).map(([value, c]) => ({ value, label: c.label }));
  }, [vocab]);

  const source = useMemo(() => {
    if (kind === "smart_list") return { kind, smartListId };
    if (kind === "filter") return { kind, filter };
    return { kind };
  }, [kind, smartListId, filter]);

  const sourceReady =
    kind === "pool" ||
    (kind === "smart_list" && !!smartListId) ||
    (kind === "filter" && !!filter);

  // Live "of N eligible" — debounced; a stale response never overwrites a
  // newer one (the seq guard).
  const seq = useRef(0);
  useEffect(() => {
    if (!open || !sourceReady) {
      setPreview(null);
      return;
    }
    const mySeq = ++seq.current;
    setPreviewing(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/assignments/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, count }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          preview?: AllocationPreview;
          error?: string;
        };
        if (seq.current !== mySeq) return;
        setPreview(json.preview ?? null);
        setPreviewErr(json.error ?? (res.ok ? "" : "Couldn't preview that source."));
      } catch {
        if (seq.current === mySeq) setPreviewErr("Couldn't preview that source.");
      } finally {
        if (seq.current === mySeq) setPreviewing(false);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [open, sourceReady, source, count]);

  const repName = members.find((m) => m.id === repId)?.name || "";
  const defaultLabel = () => {
    const day = new Date().toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return repName ? `${repName} · ${day}` : `Assignment · ${day}`;
  };

  async function commit() {
    setCommitting(true);
    setCommitErr("");
    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          repId,
          count,
          label: label.trim() || defaultLabel(),
          policy: {
            priority,
            dueDate: dueDate || null,
            dialingMode,
            maxAttempts: maxAttempts ? Number(maxAttempts) : null,
            cooldownHours: cooldownHours ? Number(cooldownHours) : null,
            campaignId: campaignId || null,
          },
          source,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        allocated?: number;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setCommitErr(json.error ?? "Couldn't allocate that assignment.");
        return;
      }
      toast({
        title: `Allocated ${json.allocated} ${
          json.allocated === 1 ? vocab.leadNoun : vocab.leadNounPlural
        }`,
        description: repName ? `Handed to ${repName}.` : undefined,
        tone: "success",
      });
      onDone();
      onClose();
    } catch {
      setCommitErr("Network error — nothing was allocated.");
    } finally {
      setCommitting(false);
    }
  }

  const canNext =
    step === 0
      ? sourceReady
      : step === 1
        ? !!repId && count > 0
        : !committing;

  const sourceCards: { key: SourceKind; title: string; description: string }[] = [
    {
      key: "pool",
      title: "Unassigned pool",
      description: `Every eligible ${vocab.leadNoun} nobody is holding, never-dialed first.`,
    },
    {
      key: "smart_list",
      title: "Smart list",
      description: "Draw from a saved list's current matches.",
    },
    {
      key: "filter",
      title: "Custom filter",
      description: "Build a one-off filter for this allocation.",
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="allocate-wizard-title"
      maxWidth="max-w-2xl"
      dismissible={!committing}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 id="allocate-wizard-title" className="text-base font-semibold tracking-tight">
            Allocate {vocab.leadNounPlural}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Step {step + 1} of {STEPS.length} · {STEPS[step]}
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" disabled={committing}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto p-5">
        {step === 0 && (
          <>
            <div role="radiogroup" aria-label="Lead source" className="grid gap-2 sm:grid-cols-3">
              {sourceCards.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="radio"
                  aria-checked={kind === c.key}
                  onClick={() => setKind(c.key)}
                  className={cn(
                    "rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    kind === c.key
                      ? "border-primary/50 bg-primary-soft"
                      : "border-border/70 bg-surface/30 hover:border-border",
                  )}
                >
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    {c.key === "pool" ? (
                      <Users className="h-3.5 w-3.5" />
                    ) : c.key === "smart_list" ? (
                      <Sparkles className="h-3.5 w-3.5" />
                    ) : (
                      <ListFilter className="h-3.5 w-3.5" />
                    )}
                    {c.title}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
                </button>
              ))}
            </div>

            {kind === "smart_list" && (
              <div>
                <Label>Smart list</Label>
                <SelectMenu
                  label="Smart list"
                  placeholder="Pick a list…"
                  className="w-full"
                  triggerClassName="w-full"
                  value={smartListId || null}
                  onChange={(v) => setSmartListId(v)}
                  options={smartLists.map((l) => ({ value: l.id, label: l.name }))}
                />
                {smartLists.length === 0 && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    No smart lists yet — save one from the {vocab.LeadNounPlural} page first.
                  </p>
                )}
              </div>
            )}

            {kind === "filter" && (
              <FilterBuilder
                value={filter}
                onChange={setFilter}
                fields={fields}
                statusOptions={statusOptions}
                campaignOptions={campaigns}
                repOptions={members}
              />
            )}
          </>
        )}

        {step === 1 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Assign to</Label>
              <SelectMenu
                label="Assign to"
                placeholder="Pick a teammate…"
                className="w-full"
                triggerClassName="w-full"
                value={repId || null}
                onChange={(v) => setRepId(v)}
                options={members.map((m) => ({ value: m.id, label: m.name || "Teammate" }))}
              />
            </div>
            <div>
              <Label htmlFor="alloc-count">How many</Label>
              <Input
                id="alloc-count"
                type="number"
                min={1}
                max={10000}
                value={count}
                onChange={(e) => setCount(Math.max(0, Number(e.target.value) || 0))}
              />
              <p className="mt-1.5 text-xs text-muted-foreground tabular" aria-live="polite">
                {previewing ? (
                  <span className="flex items-center gap-1.5">
                    <Loader2 className="h-3 w-3 animate-spin" /> Counting…
                  </span>
                ) : preview ? (
                  `of ${preview.eligible} eligible`
                ) : (
                  " "
                )}
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="alloc-label">Assignment name</Label>
                <Input
                  id="alloc-label"
                  value={label}
                  placeholder={defaultLabel()}
                  maxLength={160}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>
              <div>
                <Label>Priority</Label>
                <SelectMenu
                  label="Priority"
                  className="w-full"
                  triggerClassName="w-full"
                  value={String(priority)}
                  onChange={(v) => setPriority(Number(v) || 0)}
                  options={[
                    { value: "0", label: "Normal" },
                    { value: "1", label: "High" },
                    { value: "2", label: "Urgent" },
                  ]}
                />
              </div>
              <div>
                <Label htmlFor="alloc-due">Due date</Label>
                <Input
                  id="alloc-due"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div>
                <Label>Dialing mode</Label>
                <SelectMenu
                  label="Dialing mode"
                  className="w-full"
                  triggerClassName="w-full"
                  value={dialingMode}
                  onChange={(v) => setDialingMode(v as "manual" | "ai" | "either")}
                  options={[
                    { value: "either", label: "Either" },
                    { value: "manual", label: "Manual only" },
                    { value: "ai", label: "AI only" },
                  ]}
                />
              </div>
              <div>
                <Label>Campaign</Label>
                <SelectMenu
                  label="Campaign"
                  className="w-full"
                  triggerClassName="w-full"
                  value={campaignId || "none"}
                  onChange={(v) => setCampaignId(v === "none" ? "" : v)}
                  options={[
                    { value: "none", label: "None" },
                    ...campaigns.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </div>
              <div>
                <Label htmlFor="alloc-attempts">Max attempts</Label>
                <Input
                  id="alloc-attempts"
                  type="number"
                  min={0}
                  placeholder="No limit"
                  value={maxAttempts}
                  onChange={(e) => setMaxAttempts(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="alloc-cooldown">Cooldown (hours)</Label>
                <Input
                  id="alloc-cooldown"
                  type="number"
                  min={0}
                  placeholder="None"
                  value={cooldownHours}
                  onChange={(e) => setCooldownHours(e.target.value)}
                />
              </div>
            </div>

            {/* Review card — the same numbers the commit will act on. */}
            <div className="rounded-xl border border-border/70 bg-surface/40 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                What will happen
              </p>
              {previewing ? (
                <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Counting…
                </p>
              ) : preview ? (
                <>
                  <p className="mt-2 text-sm">
                    <b className="tabular">{preview.wouldAllocate}</b> of{" "}
                    <b className="tabular">{preview.eligible}</b> eligible{" "}
                    {vocab.leadNounPlural} will be handed to{" "}
                    <b>{repName || "the selected teammate"}</b>, never-dialed first.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {preview.excludedAssigned > 0 && (
                      <Badge tone="neutral">{preview.excludedAssigned} already assigned</Badge>
                    )}
                    {preview.excludedDnc > 0 && (
                      <Badge tone="danger">{preview.excludedDnc} on the DNC list</Badge>
                    )}
                    {preview.excludedNoPhone > 0 && (
                      <Badge tone="warning">{preview.excludedNoPhone} without a valid phone</Badge>
                    )}
                    {preview.excludedIneligible > 0 && (
                      <Badge tone="neutral">
                        {preview.excludedIneligible} not in a dialable status
                      </Badge>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {previewErr || "No preview available."}
                </p>
              )}
            </div>

            {commitErr && (
              <p className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {commitErr}
              </p>
            )}
          </>
        )}

        {previewErr && step !== 2 && (
          <p className="flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-sm font-medium text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {previewErr}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border p-5">
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={step === 0 || committing}
          onClick={() => setStep((s) => Math.max(0, s - 1))}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        {step < 2 ? (
          <Button size="sm" className="gap-1.5" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
            Next
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            size="sm"
            className="gap-1.5"
            disabled={committing || !repId || count < 1 || (preview?.wouldAllocate ?? 0) < 1}
            onClick={commit}
          >
            {committing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            Commit allocation
          </Button>
        )}
      </div>
    </Modal>
  );
}
