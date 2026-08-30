"use client";

import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  Copy,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilterBuilder, LiveCount } from "@/components/leads/filter-builder";
import { useVocabulary } from "@/components/layout/vocabulary";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type {
  CampaignAudience,
  CampaignDialingMode,
  CampaignDialingPolicy,
  CampaignGoals,
  CampaignRetryPolicy,
  CampaignWindow,
} from "@/lib/campaign-policy";
import type { LeadFieldDef } from "@/lib/leads/field-schema";
import type { FilterSpec } from "@/lib/leads/filter-spec";
import { campaignStatusConfig } from "@/lib/status";
import type { CampaignStatus } from "@/lib/types";
import { cn, formatPhone } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Campaign Builder — /campaigns/[id]/edit. One SectionCard per concern, each
// with its OWN save (the org-settings-form per-section pattern): a PATCH to
// /api/campaigns carrying just that section's fields, so saving pacing can
// never clobber a script edit in another tab. The server sanitizes every jsonb
// payload and validates caller IDs / disposition keys against the org — this
// component only offers choices the workspace actually has.
//
// This page RETIRED the old EditCampaignDialog (scripts included) — one
// editing surface, no dead controls.
// ─────────────────────────────────────────────────────────────────────────────

export interface BuilderCampaign {
  id: string;
  name: string;
  description: string;
  objective: string;
  utilityProvider: string;
  color: string;
  status: CampaignStatus;
  archivedAt: string | null;
  scriptA: string;
  scriptB: string;
  audience: CampaignAudience | null;
  dialingPolicy: CampaignDialingPolicy | null;
  callerIds: string[];
  retryPolicy: CampaignRetryPolicy | null;
  dispositionKeys: string[];
  goals: CampaignGoals | null;
}

/** "No campaign policy" — everything inherits from the org's own settings. */
const EMPTY_POLICY: CampaignDialingPolicy = {
  modes: [],
  windows: [],
  timezone: "",
  pacing: { callsPerRun: 0, maxConcurrent: 0 },
};

export function CampaignBuilder({
  campaign,
  providerLabel,
  callerIdPool,
  dispositionOptions,
  smartLists,
  fields,
  statusOptions,
  campaignOptions,
  repOptions,
  orgLimits,
}: {
  campaign: BuilderCampaign;
  /** The org's resolved label for the utilityProvider core slot. */
  providerLabel: string;
  /** The org's caller-ID rotation pool (settings.dialing.callerIds). */
  callerIdPool: string[];
  /** resolveDispositionDefs over the org settings, pre-flattened for the UI. */
  dispositionOptions: { key: string; label: string }[];
  smartLists: { id: string; name: string }[];
  /** The org's resolved lead schema — feeds the audience FilterBuilder. */
  fields: LeadFieldDef[];
  statusOptions: { value: string; label: string }[];
  campaignOptions: { id: string; name: string }[];
  repOptions: { id: string; name: string }[];
  /** The org's own ceilings, for the "clamped at runtime" note. */
  orgLimits: { callsPerRun: number; maxConcurrent: number };
}) {
  const router = useRouter();
  const { toast } = useToast();
  const confirmDialog = useConfirm();
  const vocab = useVocabulary();
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // ── Section state (seeded from the sanitized row) ──────────────────────────
  const [identity, setIdentity] = useState({
    name: campaign.name,
    description: campaign.description,
    objective: campaign.objective,
    utilityProvider: campaign.utilityProvider,
    color: campaign.color || "#3B82F6",
    status: campaign.status,
  });
  const [archived, setArchived] = useState(Boolean(campaign.archivedAt));

  const audience = campaign.audience;
  const [audKind, setAudKind] = useState<CampaignAudience["kind"]>(audience?.kind ?? "all");
  const [audSmartListId, setAudSmartListId] = useState(audience?.smartListId ?? "");
  const [audFilter, setAudFilter] = useState<FilterSpec | null>(audience?.filter ?? null);

  const policy = campaign.dialingPolicy ?? EMPTY_POLICY;
  const [modes, setModes] = useState<CampaignDialingMode[]>(policy.modes);
  const [windows, setWindows] = useState<CampaignWindow[]>(policy.windows);
  const [policyTz, setPolicyTz] = useState(policy.timezone);
  const [pacing, setPacing] = useState(policy.pacing);

  const [callerIds, setCallerIds] = useState<string[]>(
    campaign.callerIds.filter((n) => callerIdPool.includes(n)),
  );
  const [retry, setRetry] = useState<CampaignRetryPolicy>(
    campaign.retryPolicy ?? { maxAttempts: 0, cooldownHours: 0 },
  );
  const [scriptA, setScriptA] = useState(campaign.scriptA);
  const [scriptB, setScriptB] = useState(campaign.scriptB);
  const [dispoKeys, setDispoKeys] = useState<string[]>(
    campaign.dispositionKeys.filter((k) => dispositionOptions.some((d) => d.key === k)),
  );
  const [goals, setGoals] = useState<CampaignGoals>({
    appointments: campaign.goals?.appointments ?? 0,
    connects: campaign.goals?.connects ?? 0,
    periodDays: campaign.goals?.periodDays ?? 30,
  });

  async function save(patch: Record<string, unknown>, key: string) {
    setBusy(key);
    setSaved(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: campaign.id, ...patch }),
      });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        toast({ title: "Couldn't save", description: j.error ?? "Try again.", tone: "danger" });
        return;
      }
      setSaved(key);
      toast({ title: "Saved", tone: "success" });
      router.refresh();
      setTimeout(() => setSaved((s) => (s === key ? null : s)), 2500);
    } catch {
      toast({ title: "Network error while saving.", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  const SaveBtn = ({ k, onClick }: { k: string; onClick: () => void }) => (
    <Button size="sm" className="gap-2" disabled={busy === k} onClick={onClick}>
      {busy === k ? (
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
      ) : saved === k ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <Save className="h-4 w-4" />
      )}
      {saved === k ? "Saved" : "Save"}
    </Button>
  );

  async function duplicate() {
    setBusy("clone");
    try {
      const res = await fetch("/api/campaigns/clone", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: campaign.id }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        error?: string;
      };
      if (!res.ok || !j.ok || !j.id) {
        toast({ title: "Couldn't duplicate", description: j.error, tone: "danger" });
        return;
      }
      toast({ title: "Campaign duplicated", description: "The copy starts paused.", tone: "success" });
      router.push(`/campaigns/${j.id}/edit`);
    } catch {
      toast({ title: "Network error while duplicating.", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  async function toggleArchive() {
    const next = !archived;
    const ok = await confirmDialog({
      title: next ? `Archive "${identity.name}"?` : `Restore "${identity.name}"?`,
      body: next
        ? "Archived campaigns keep their history but drop out of active dialing flows."
        : "The campaign returns to active flows with its setup intact.",
      tone: next ? "danger" : "default",
      confirmLabel: next ? "Archive campaign" : "Restore campaign",
    });
    if (!ok) return;
    setArchived(next);
    await save({ archived: next }, "archive");
  }

  function saveAudience() {
    if (audKind === "smart_list" && !audSmartListId) {
      toast({ title: "Pick a smart list first.", tone: "danger" });
      return;
    }
    if (audKind === "filter" && (!audFilter || audFilter.groups.length === 0)) {
      toast({ title: "Add at least one filter condition first.", tone: "danger" });
      return;
    }
    const payload: CampaignAudience =
      audKind === "smart_list"
        ? { kind: "smart_list", smartListId: audSmartListId }
        : audKind === "filter"
          ? { kind: "filter", filter: audFilter! }
          : { kind: "all" };
    void save({ audience: payload }, "audience");
  }

  const pacingClamped =
    (pacing.callsPerRun > 0 && orgLimits.callsPerRun > 0 && pacing.callsPerRun > orgLimits.callsPerRun) ||
    (pacing.maxConcurrent > 0 && orgLimits.maxConcurrent > 0 && pacing.maxConcurrent > orgLimits.maxConcurrent);

  return (
    <div className="space-y-4">
      {/* ── Identity ──────────────────────────────────────────────────────── */}
      <SectionCard
        title="Identity"
        description="Name, story, and lifecycle — how this campaign presents everywhere."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Campaign name">
            <Input
              value={identity.name}
              onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
            />
          </Field>
          {/* The org's OWN label for this core slot (resolveLeadFields) — never
              a hardcoded industry noun. */}
          <Field label={providerLabel}>
            <Input
              value={identity.utilityProvider}
              placeholder="Leave blank to target all"
              onChange={(e) => setIdentity({ ...identity, utilityProvider: e.target.value })}
            />
          </Field>
          <Field label="Objective">
            <Input
              value={identity.objective}
              placeholder="e.g. Book 20 reviews from the spring list"
              onChange={(e) => setIdentity({ ...identity, objective: e.target.value })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Color">
              <input
                type="color"
                value={identity.color}
                onChange={(e) => setIdentity({ ...identity, color: e.target.value })}
                className="h-10 w-full cursor-pointer rounded-xl border border-border bg-background"
                aria-label="Campaign color"
              />
            </Field>
            <Field label="Status">
              <Select
                value={identity.status}
                onChange={(e) =>
                  setIdentity({ ...identity, status: e.target.value as CampaignStatus })
                }
              >
                {(Object.keys(campaignStatusConfig) as CampaignStatus[]).map((value) => (
                  <option key={value} value={value}>
                    {campaignStatusConfig[value].label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description" className="sm:col-span-2">
            <Textarea
              value={identity.description}
              placeholder="What this campaign is for, in a sentence or two."
              onChange={(e) => setIdentity({ ...identity, description: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              disabled={busy === "clone"}
              onClick={duplicate}
            >
              {busy === "clone" ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
              Duplicate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn("gap-2", !archived && "text-danger hover:text-danger")}
              disabled={busy === "archive"}
              onClick={toggleArchive}
            >
              {busy === "archive" ? (
                <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              ) : archived ? (
                <ArchiveRestore className="h-4 w-4" />
              ) : (
                <Archive className="h-4 w-4" />
              )}
              {archived ? "Restore campaign" : "Archive campaign"}
            </Button>
          </div>
          <SaveBtn
            k="identity"
            onClick={() =>
              save(
                {
                  name: identity.name,
                  description: identity.description,
                  objective: identity.objective,
                  utilityProvider: identity.utilityProvider,
                  color: identity.color,
                  status: identity.status,
                },
                "identity",
              )
            }
          />
        </div>
      </SectionCard>

      {/* ── Audience ──────────────────────────────────────────────────────── */}
      <SectionCard
        title="Audience"
        description={`Which ${vocab.leadNounPlural} this campaign targets.`}
      >
        <div className="space-y-2" role="radiogroup" aria-label="Audience kind">
          <RadioRow
            checked={audKind === "all"}
            onSelect={() => setAudKind("all")}
            label={`All ${vocab.leadNounPlural}`}
            hint="Everything assigned to this campaign, no extra narrowing."
          />
          <RadioRow
            checked={audKind === "smart_list"}
            onSelect={() => setAudKind("smart_list")}
            label="A smart list"
            hint="Follow a saved list — the audience updates as the list does."
          />
          {audKind === "smart_list" && (
            <div className="ml-7">
              {smartLists.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No smart lists yet — create one from the {vocab.LeadNounPlural} page first.
                </p>
              ) : (
                <Select
                  value={audSmartListId}
                  onChange={(e) => setAudSmartListId(e.target.value)}
                  aria-label="Smart list"
                >
                  <option value="">Choose a smart list…</option>
                  {smartLists.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}
          <RadioRow
            checked={audKind === "filter"}
            onSelect={() => setAudKind("filter")}
            label="A custom filter"
            hint="Build the exact conditions inline."
          />
        </div>
        {audKind === "filter" && (
          <div className="mt-3 space-y-2">
            <FilterBuilder
              value={audFilter}
              onChange={setAudFilter}
              fields={fields}
              statusOptions={statusOptions}
              campaignOptions={campaignOptions}
              repOptions={repOptions}
            />
            <LiveCount filter={audFilter} />
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <SaveBtn k="audience" onClick={saveAudience} />
        </div>
      </SectionCard>

      {/* ── Dialing policy ────────────────────────────────────────────────── */}
      <SectionCard
        title="Dialing policy"
        description="How this campaign may be worked — modes, calling windows, and pacing."
      >
        <div className="space-y-2">
          <CheckRow
            checked={modes.includes("manual")}
            onToggle={() =>
              setModes(
                modes.includes("manual")
                  ? modes.filter((m) => m !== "manual")
                  : [...modes, "manual"],
              )
            }
            label="Manual dialing"
            hint="Reps can pull this campaign into the power dialer."
          />
          <CheckRow
            checked={modes.includes("ai")}
            onToggle={() =>
              setModes(modes.includes("ai") ? modes.filter((m) => m !== "ai") : [...modes, "ai"])
            }
            label="AI dialing"
            hint="The AI agent (and the unattended scheduler) may place calls."
          />
          <p className="text-xs text-muted-foreground">
            Nothing checked = no restriction — both modes may work this campaign.
          </p>
        </div>

        {/* The hour-window row idiom from Admin → Automated calling, so the two
            editors read identically. End hour is exclusive. */}
        <div className="mt-4">
          <Label>Calling windows (24-hour, end is exclusive — empty follows the org schedule)</Label>
          <div className="space-y-2">
            {windows.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="w-20"
                  type="number"
                  min={0}
                  max={23}
                  value={w.start}
                  aria-label={`Window ${i + 1} start hour`}
                  onChange={(e) => {
                    const start = Math.max(0, Math.min(23, Number(e.target.value) || 0));
                    setWindows(windows.map((x, j) => (j === i ? { ...x, start } : x)));
                  }}
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  className="w-20"
                  type="number"
                  min={1}
                  max={24}
                  value={w.end}
                  aria-label={`Window ${i + 1} end hour`}
                  onChange={(e) => {
                    const end = Math.max(1, Math.min(24, Number(e.target.value) || 1));
                    setWindows(windows.map((x, j) => (j === i ? { ...x, end } : x)));
                  }}
                />
                <button
                  type="button"
                  aria-label="Remove window"
                  onClick={() => setWindows(windows.filter((_, j) => j !== i))}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted/60"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setWindows([...windows, { start: 9, end: 10 }])}
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted/60"
            >
              <Plus className="h-4 w-4" />
              Add window
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Timezone (blank = org's)">
            <Input
              value={policyTz}
              placeholder="America/Chicago"
              onChange={(e) => setPolicyTz(e.target.value)}
            />
          </Field>
          <NumberField
            label="Calls per run (0 = org default)"
            value={pacing.callsPerRun}
            min={0}
            max={100}
            onChange={(n) => setPacing({ ...pacing, callsPerRun: n })}
          />
          <NumberField
            label="Max concurrent (0 = org default)"
            value={pacing.maxConcurrent}
            min={0}
            max={100}
            onChange={(n) => setPacing({ ...pacing, maxConcurrent: n })}
          />
        </div>
        {pacingClamped && (
          <p className="mt-2 text-xs font-medium text-warning">
            Pacing above the workspace limits ({orgLimits.callsPerRun} calls/run,{" "}
            {orgLimits.maxConcurrent} concurrent) is clamped at runtime — a campaign can
            narrow the org's pace, never exceed it.
          </p>
        )}
        <div className="mt-4 flex justify-end">
          <SaveBtn
            k="policy"
            onClick={() =>
              save(
                { dialingPolicy: { modes, windows, timezone: policyTz, pacing } },
                "policy",
              )
            }
          />
        </div>
      </SectionCard>

      {/* ── Caller IDs ────────────────────────────────────────────────────── */}
      <SectionCard
        title="Caller IDs"
        description="Dial this campaign from a subset of the workspace pool. Nothing checked = the whole pool."
      >
        {callerIdPool.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No caller-ID pool configured — add numbers in Admin → Organization settings
            → Dialing first.
          </p>
        ) : (
          <div className="space-y-2">
            {callerIdPool.map((n) => (
              <CheckRow
                key={n}
                checked={callerIds.includes(n)}
                onToggle={() =>
                  setCallerIds(
                    callerIds.includes(n)
                      ? callerIds.filter((x) => x !== n)
                      : [...callerIds, n],
                  )
                }
                label={formatPhone(n)}
              />
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <SaveBtn k="callerIds" onClick={() => save({ callerIds }, "callerIds")} />
        </div>
      </SectionCard>

      {/* ── Retry policy ──────────────────────────────────────────────────── */}
      <SectionCard
        title="Retry policy"
        description="How persistently this campaign chases a number."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <NumberField
            label="Max attempts (0 = no cap)"
            value={retry.maxAttempts}
            min={0}
            max={99}
            onChange={(n) => setRetry({ ...retry, maxAttempts: n })}
          />
          <NumberField
            label="Cooldown between attempts (hours, 0 = none)"
            value={retry.cooldownHours}
            min={0}
            max={720}
            onChange={(n) => setRetry({ ...retry, cooldownHours: n })}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          The eligibility engine enforces these on every claim: a {vocab.leadNoun} at the
          attempt cap shows as <span className="font-semibold">Exhausted</span> in the
          funnel, and one inside the cooldown simply isn&apos;t offered to any dialer until
          it lapses.
        </p>
        <div className="mt-4 flex justify-end">
          <SaveBtn k="retry" onClick={() => save({ retryPolicy: retry }, "retry")} />
        </div>
      </SectionCard>

      {/* ── Scripts ───────────────────────────────────────────────────────── */}
      <SectionCard
        title="Scripts"
        description="What reps see in the dialer. Setting BOTH runs an A/B test — each lead is deterministically assigned one script, and results split on the campaign page."
      >
        <div className="space-y-4">
          <Field label="Script A">
            <Textarea
              value={scriptA}
              onChange={(e) => setScriptA(e.target.value)}
              placeholder="Hi {first name}, this is … calling about…"
            />
          </Field>
          <Field label="Script B (leave empty to run a single script)">
            <Textarea
              value={scriptB}
              onChange={(e) => setScriptB(e.target.value)}
              placeholder="An alternative opener to test against Script A…"
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn k="scripts" onClick={() => save({ scriptA, scriptB }, "scripts")} />
        </div>
      </SectionCard>

      {/* ── Dispositions ──────────────────────────────────────────────────── */}
      <SectionCard
        title="Dispositions"
        description="Which wrap-up outcomes this campaign offers. Nothing checked = all of them."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {dispositionOptions.map((d) => (
            <CheckRow
              key={d.key}
              checked={dispoKeys.includes(d.key)}
              onToggle={() =>
                setDispoKeys(
                  dispoKeys.includes(d.key)
                    ? dispoKeys.filter((k) => k !== d.key)
                    : [...dispoKeys, d.key],
                )
              }
              label={d.label}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn k="dispositions" onClick={() => save({ dispositionKeys: dispoKeys }, "dispositions")} />
        </div>
      </SectionCard>

      {/* ── Goals ─────────────────────────────────────────────────────────── */}
      <SectionCard
        title="Goals"
        description="What success looks like, so reports can say whether you're on pace."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <NumberField
            label={cap(vocab.appointmentNounPlural)}
            value={goals.appointments ?? 0}
            min={0}
            max={1_000_000}
            onChange={(n) => setGoals({ ...goals, appointments: n })}
          />
          <NumberField
            label="Connects"
            value={goals.connects ?? 0}
            min={0}
            max={1_000_000}
            onChange={(n) => setGoals({ ...goals, connects: n })}
          />
          <NumberField
            label="Over (days)"
            value={goals.periodDays ?? 30}
            min={1}
            max={365}
            onChange={(n) => setGoals({ ...goals, periodDays: n })}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn k="goals" onClick={() => save({ goals }, "goals")} />
        </div>
      </SectionCard>
    </div>
  );
}

// ── Local form primitives (the org-settings-form idiom) ──────────────────────

const cap = (w: string) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w);

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) =>
          onChange(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || 0))))
        }
      />
    </Field>
  );
}

function CheckRow({
  checked,
  onToggle,
  label,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 px-3 py-2.5 transition-colors hover:bg-muted/40">
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

function RadioRow({
  checked,
  onSelect,
  label,
  hint,
}: {
  checked: boolean;
  onSelect: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/60 px-3 py-2.5 transition-colors hover:bg-muted/40">
      <input
        type="radio"
        checked={checked}
        onChange={onSelect}
        className="mt-0.5 h-4 w-4 shrink-0 rounded border-input accent-primary"
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
