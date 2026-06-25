"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  KeyRound,
  Loader2,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { EMILY_SYSTEM_PROMPT } from "@/lib/ai/agent-prompt";
import type { OrgFull, OrgSettings, OrgUpdate } from "@/lib/org/membership";
import { DIALER_TEMPLATES } from "@/lib/org/templates";
import { ROLE_LABEL } from "@/lib/permissions";
import { cn } from "@/lib/utils";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const FEATURE_FLAGS: { key: keyof OrgSettings["features"]; label: string }[] = [
  { key: "aiDialer", label: "Power dialer" },
  { key: "manualDialer", label: "Manual dialing" },
  { key: "leads", label: "Leads" },
  { key: "appointments", label: "Appointments" },
  { key: "callbacks", label: "Callbacks" },
  { key: "liveMonitor", label: "Live monitor" },
  { key: "leaderboard", label: "Leaderboard" },
  { key: "campaigns", label: "Campaigns" },
  { key: "reports", label: "Reports" },
  { key: "aiAgent", label: "AI agent" },
];

export function OrgSettingsForm({
  org,
  canDelete,
}: {
  org: OrgFull;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const [identity, setIdentity] = useState({
    name: org.name,
    productName: org.productName,
    tagline: org.tagline,
    description: org.description,
    industry: org.industry,
    website: org.website,
    dialerTemplate: org.dialerTemplate,
    brandColor: org.brandColor,
    accentColor: org.accentColor,
    logoUrl: org.logoUrl,
  });
  const [access, setAccess] = useState({
    requireApproval: org.requireApproval,
    allowJoin: org.allowJoin,
    defaultRole: org.defaultRole as string,
  });
  const [joinCode, setJoinCode] = useState(org.joinCode);
  const [timezone, setTimezone] = useState(org.timezone);
  const [dialing, setDialing] = useState<OrgSettings["dialing"]>(org.settings.dialing);
  const [hours, setHours] = useState<OrgSettings["hours"]>(org.settings.hours);
  const [ai, setAi] = useState<OrgSettings["ai"]>(() => {
    // Surface the built-in solar (Emily) script so it's visible/editable/copyable.
    const base = org.settings.ai;
    if (org.dialerTemplate === "solar" && !base.systemPrompt) {
      return { ...base, systemPrompt: EMILY_SYSTEM_PROMPT };
    }
    return base;
  });
  const [compliance, setCompliance] = useState<OrgSettings["compliance"]>(
    org.settings.compliance,
  );
  const [dispositions, setDispositions] = useState<OrgSettings["dispositions"]>(
    org.settings.dispositions,
  );
  const [features, setFeatures] = useState<OrgSettings["features"]>(
    org.settings.features,
  );
  const [terms, setTerms] = useState({
    leadNoun: org.settings.leadNoun,
    leadNounPlural: org.settings.leadNounPlural,
  });

  async function save(patch: OrgUpdate, key: string) {
    setBusy(key);
    setErr("");
    setSaved(null);
    try {
      const res = await fetch("/api/org/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "Could not save.");
        return;
      }
      setSaved(key);
      router.refresh();
      setTimeout(() => setSaved((s) => (s === key ? null : s)), 2500);
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  }

  async function rotateCode() {
    setBusy("code");
    setErr("");
    try {
      const res = await fetch("/api/org/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "rotateCode" }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.ok && j.code) {
        setJoinCode(j.code);
        router.refresh();
      } else setErr(j.error ?? "Could not rotate code.");
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  }

  async function deleteOrg() {
    if (!confirm(`Delete ${org.name}? This removes the organization for everyone.`))
      return;
    setBusy("delete");
    try {
      const res = await fetch("/api/org/settings", { method: "DELETE" });
      const j = await res.json().catch(() => ({}));
      if (j.ok) {
        router.push("/hub");
        router.refresh();
      } else setErr(j.error ?? "Could not delete.");
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  }

  const SaveBtn = ({ k, onClick }: { k: string; onClick: () => void }) => (
    <Button size="sm" className="gap-2" disabled={busy === k} onClick={onClick}>
      {busy === k ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : saved === k ? (
        <CheckCircle2 className="h-4 w-4" />
      ) : (
        <Save className="h-4 w-4" />
      )}
      {saved === k ? "Saved" : "Save"}
    </Button>
  );

  return (
    <div className="space-y-4">
      {err && (
        <p className="flex items-center gap-1.5 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          <AlertTriangle className="h-4 w-4" />
          {err}
        </p>
      )}

      {/* Identity & branding */}
      <SectionCard
        title="Identity & branding"
        description="How your organization presents across the dialer."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Organization name">
            <Input
              value={identity.name}
              onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
            />
          </Field>
          <Field label="Product name">
            <Input
              value={identity.productName}
              placeholder="e.g. Sunrun Resolution Dialer"
              onChange={(e) => setIdentity({ ...identity, productName: e.target.value })}
            />
          </Field>
          <Field label="Tagline">
            <Input
              value={identity.tagline}
              onChange={(e) => setIdentity({ ...identity, tagline: e.target.value })}
            />
          </Field>
          <Field label="Industry">
            <Input
              value={identity.industry}
              onChange={(e) => setIdentity({ ...identity, industry: e.target.value })}
            />
          </Field>
          <Field label="Specialization">
            <Select
              value={identity.dialerTemplate}
              onChange={(e) =>
                setIdentity({ ...identity, dialerTemplate: e.target.value })
              }
            >
              {DIALER_TEMPLATES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} — {t.blurb}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Website">
            <Input
              value={identity.website}
              placeholder="https://"
              onChange={(e) => setIdentity({ ...identity, website: e.target.value })}
            />
          </Field>
          <Field label="Brand color">
            <ColorInput
              value={identity.brandColor}
              onChange={(v) => setIdentity({ ...identity, brandColor: v })}
            />
          </Field>
          <Field label="Accent color">
            <ColorInput
              value={identity.accentColor}
              onChange={(v) => setIdentity({ ...identity, accentColor: v })}
            />
          </Field>
          <Field label="Logo URL" className="sm:col-span-2">
            <Input
              value={identity.logoUrl}
              placeholder="https://…/logo.png"
              onChange={(e) => setIdentity({ ...identity, logoUrl: e.target.value })}
            />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea
              value={identity.description}
              onChange={(e) => setIdentity({ ...identity, description: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn k="identity" onClick={() => save(identity, "identity")} />
        </div>
      </SectionCard>

      {/* Membership & access */}
      <SectionCard
        title="Membership & access"
        description="Control who can join and how new members are handled."
      >
        <div className="space-y-3">
          <Toggle
            label="Require approval to join"
            hint="New join requests must be approved by a manager."
            checked={access.requireApproval}
            onChange={(v) => setAccess({ ...access, requireApproval: v })}
          />
          <Toggle
            label="Allow new members to join"
            hint="Turn off to freeze the organization to its current members."
            checked={access.allowJoin}
            onChange={(v) => setAccess({ ...access, allowJoin: v })}
          />
          <Field label="Default role for new members">
            <Select
              value={access.defaultRole}
              onChange={(e) => setAccess({ ...access, defaultRole: e.target.value })}
            >
              {(["rep", "manager", "admin"] as const).map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn
            k="access"
            onClick={() =>
              save(
                {
                  requireApproval: access.requireApproval,
                  allowJoin: access.allowJoin,
                  defaultRole: access.defaultRole as OrgUpdate["defaultRole"],
                },
                "access",
              )
            }
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <KeyRound className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Join code
            </p>
            <p className="font-mono text-xl font-bold tracking-[0.25em]">{joinCode}</p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() => navigator.clipboard?.writeText(joinCode)}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy === "code"}
            onClick={rotateCode}
          >
            {busy === "code" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Rotate
          </Button>
        </div>
      </SectionCard>

      {/* Dialing */}
      <SectionCard
        title="Dialing"
        description="How the power dialer places and paces calls."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Dialing mode">
            <Select
              value={dialing.mode}
              onChange={(e) =>
                setDialing({ ...dialing, mode: e.target.value as typeof dialing.mode })
              }
            >
              <option value="preview">Preview</option>
              <option value="progressive">Progressive</option>
              <option value="predictive">Predictive</option>
            </Select>
          </Field>
          <Field label="Caller ID">
            <Input
              value={dialing.callerId}
              placeholder="+1…"
              onChange={(e) => setDialing({ ...dialing, callerId: e.target.value })}
            />
          </Field>
          <NumberField
            label="Max concurrent lines"
            value={dialing.maxLines}
            onChange={(n) => setDialing({ ...dialing, maxLines: n })}
          />
          <NumberField
            label="Ring timeout (sec)"
            value={dialing.ringTimeoutSec}
            onChange={(n) => setDialing({ ...dialing, ringTimeoutSec: n })}
          />
          <NumberField
            label="Retry attempts"
            value={dialing.retryAttempts}
            onChange={(n) => setDialing({ ...dialing, retryAttempts: n })}
          />
          <NumberField
            label="Retry delay (min)"
            value={dialing.retryDelayMin}
            onChange={(n) => setDialing({ ...dialing, retryDelayMin: n })}
          />
          <NumberField
            label="Rotate caller ID every (calls)"
            value={dialing.rotateEvery}
            onChange={(n) => setDialing({ ...dialing, rotateEvery: Math.max(1, n) })}
          />
        </div>
        <div className="mt-4">
          <Field label="Caller ID rotation pool">
            <Textarea
              value={(dialing.callerIds ?? []).join("\n")}
              placeholder={"+13466456704\n+1…  (one number per line)"}
              onChange={(e) =>
                setDialing({
                  ...dialing,
                  callerIds: e.target.value
                    .split(/[\n,]/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
            />
          </Field>
          <p className="mt-1.5 text-xs text-muted-foreground">
            One E.164 number per line. The dialer cycles through these for both
            manual and AI calls, switching every{" "}
            <span className="font-semibold tabular">
              {Math.max(1, dialing.rotateEvery || 1)}
            </span>{" "}
            call{(dialing.rotateEvery || 1) === 1 ? "" : "s"}. Leave empty to always
            use the single Caller ID above. Each number must be one you own in
            Twilio (and, for AI calls, imported into ElevenLabs).
          </p>
        </div>
        <div className="mt-3 space-y-3">
          <Toggle
            label="Record calls"
            checked={dialing.recording}
            onChange={(v) => setDialing({ ...dialing, recording: v })}
          />
          <Toggle
            label="Voicemail drop"
            hint="Leave a pre-recorded message on no-answer."
            checked={dialing.voicemailDrop}
            onChange={(v) => setDialing({ ...dialing, voicemailDrop: v })}
          />
          <Toggle
            label="Respect Do-Not-Call list"
            checked={dialing.respectDnc}
            onChange={(v) => setDialing({ ...dialing, respectDnc: v })}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn k="dialing" onClick={() => save({ settings: { dialing } }, "dialing")} />
        </div>
      </SectionCard>

      {/* Business hours */}
      <SectionCard
        title="Calling hours"
        description="When the dialer is allowed to call, in the org timezone."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Timezone" className="sm:col-span-3">
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </Field>
          <NumberField
            label="Start hour (0–23)"
            value={hours.startHour}
            onChange={(n) => setHours({ ...hours, startHour: n })}
          />
          <NumberField
            label="End hour (0–23)"
            value={hours.endHour}
            onChange={(n) => setHours({ ...hours, endHour: n })}
          />
        </div>
        <div className="mt-3">
          <Label>Calling days</Label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = hours.days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    setHours({
                      ...hours,
                      days: on
                        ? hours.days.filter((x) => x !== i)
                        : [...hours.days, i].sort(),
                    })
                  }
                  className={cn(
                    "h-9 w-12 rounded-lg border text-xs font-semibold transition-colors",
                    on
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border text-muted-foreground hover:bg-muted/60",
                  )}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn
            k="hours"
            onClick={() => save({ timezone, settings: { hours } }, "hours")}
          />
        </div>
      </SectionCard>

      {/* AI agent */}
      <SectionCard
        title="AI agent"
        description="The voice, persona, and behavior of your AI caller."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Agent name">
            <Input value={ai.agentName} onChange={(e) => setAi({ ...ai, agentName: e.target.value })} />
          </Field>
          <Field label="Voice">
            <Input value={ai.voice} onChange={(e) => setAi({ ...ai, voice: e.target.value })} />
          </Field>
          <Field label="Transfer number">
            <Input
              value={ai.transferNumber}
              placeholder="+1…"
              onChange={(e) => setAi({ ...ai, transferNumber: e.target.value })}
            />
          </Field>
          <Field label="Language">
            <Input value={ai.language} onChange={(e) => setAi({ ...ai, language: e.target.value })} />
          </Field>
          <NumberField
            label="Max AI talk time (min)"
            value={ai.maxTalkMin}
            onChange={(n) => setAi({ ...ai, maxTalkMin: n })}
          />
          <Field label="Voice speed (0.7 slow – 1.2 fast)">
            <Input
              type="number"
              step="0.05"
              min="0.7"
              max="1.2"
              value={ai.voiceSpeed}
              onChange={(e) => setAi({ ...ai, voiceSpeed: Number(e.target.value) })}
            />
          </Field>
          <Field label="Persona / instructions" className="sm:col-span-2">
            <Textarea value={ai.persona} onChange={(e) => setAi({ ...ai, persona: e.target.value })} />
          </Field>
          <Field label="Opening greeting" className="sm:col-span-2">
            <Textarea
              value={ai.greeting}
              onChange={(e) => setAi({ ...ai, greeting: e.target.value })}
              placeholder="Use {agent} and {org} as placeholders."
            />
          </Field>
          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-center justify-between">
              <Label className="mb-0">System prompt (paste this into ElevenLabs)</Label>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(ai.systemPrompt)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <Copy className="h-3.5 w-3.5" />
                Copy
              </button>
            </div>
            <Textarea
              value={ai.systemPrompt}
              onChange={(e) => setAi({ ...ai, systemPrompt: e.target.value })}
              placeholder="Leave blank to use the built-in script for this vertical (Sunrun uses the Emily resolution script)."
              className="min-h-[140px] font-mono text-xs"
            />
          </div>
        </div>
        <div className="mt-3">
          <Toggle
            label="AI-first dialing"
            hint="The AI agent calls first; reps take over on request."
            checked={ai.aiFirst}
            onChange={(v) => setAi({ ...ai, aiFirst: v })}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn k="ai" onClick={() => save({ settings: { ai } }, "ai")} />
        </div>
      </SectionCard>

      {/* Compliance */}
      <SectionCard
        title="Compliance"
        description="Recording disclosure, consent & DNC enforcement."
      >
        <div className="space-y-3">
          <Toggle
            label="Enforce Do-Not-Call"
            checked={compliance.dncEnforced}
            onChange={(v) => setCompliance({ ...compliance, dncEnforced: v })}
          />
          <Toggle
            label="Require consent before recording"
            checked={compliance.consentRequired}
            onChange={(v) => setCompliance({ ...compliance, consentRequired: v })}
          />
          <Field label="Recording disclosure">
            <Textarea
              value={compliance.recordingDisclosure}
              onChange={(e) =>
                setCompliance({ ...compliance, recordingDisclosure: e.target.value })
              }
            />
          </Field>
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn
            k="compliance"
            onClick={() => save({ settings: { compliance } }, "compliance")}
          />
        </div>
      </SectionCard>

      {/* Dispositions */}
      <SectionCard
        title="Call dispositions"
        description="The outcomes reps & the AI can log on a call."
      >
        <div className="space-y-2">
          {dispositions.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                value={d.label}
                onChange={(e) => {
                  const next = [...dispositions];
                  next[i] = { ...d, label: e.target.value };
                  setDispositions(next);
                }}
              />
              <Select
                className="w-36"
                value={d.tone}
                onChange={(e) => {
                  const next = [...dispositions];
                  next[i] = { ...d, tone: e.target.value as typeof d.tone };
                  setDispositions(next);
                }}
              >
                <option value="success">Positive</option>
                <option value="warning">Neutral</option>
                <option value="danger">Negative</option>
                <option value="neutral">Info</option>
              </Select>
              <button
                type="button"
                aria-label="Remove"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
                onClick={() => setDispositions(dispositions.filter((_, x) => x !== i))}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            onClick={() =>
              setDispositions([...dispositions, { label: "New outcome", tone: "neutral" }])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            Add disposition
          </Button>
          <SaveBtn k="disp" onClick={() => save({ settings: { dispositions } }, "disp")} />
        </div>
      </SectionCard>

      {/* Features & terminology */}
      <SectionCard
        title="Features & terminology"
        description="Turn whole areas of the dialer on or off, and tailor the wording."
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Contact noun (singular)">
            <Input
              value={terms.leadNoun}
              placeholder="lead"
              onChange={(e) => setTerms({ ...terms, leadNoun: e.target.value })}
            />
          </Field>
          <Field label="Contact noun (plural)">
            <Input
              value={terms.leadNounPlural}
              placeholder="leads"
              onChange={(e) => setTerms({ ...terms, leadNounPlural: e.target.value })}
            />
          </Field>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {FEATURE_FLAGS.map(({ key, label }) => (
            <Toggle
              key={key}
              label={label}
              checked={features[key]}
              onChange={(v) => setFeatures({ ...features, [key]: v })}
            />
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <SaveBtn
            k="features"
            onClick={() =>
              save(
                {
                  settings: {
                    features,
                    leadNoun: terms.leadNoun,
                    leadNounPlural: terms.leadNounPlural,
                  },
                },
                "features",
              )
            }
          />
        </div>
      </SectionCard>

      {/* Danger zone */}
      {canDelete && (
        <SectionCard
          title="Danger zone"
          description="Irreversible actions for the organization owner."
        >
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 bg-danger/5 p-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-danger" />
              <div>
                <p className="text-sm font-semibold">Delete this organization</p>
                <p className="text-xs text-muted-foreground">
                  Members are unassigned and sent back to the Hub.
                </p>
              </div>
            </div>
            <Button
              variant="danger"
              size="sm"
              className="gap-1.5"
              disabled={busy === "delete"}
              onClick={deleteOrg}
            >
              {busy === "delete" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              Delete organization
            </Button>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

// ── small building blocks ────────────────────────────────────────────────────
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
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
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

function ColorInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value || "#2563eb"}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-background"
        aria-label="Pick color"
      />
      <Input
        value={value}
        placeholder="#2563eb"
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/50 px-4 py-3">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-muted transition-colors peer-checked:bg-primary">
        <span
          className={cn(
            "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-5",
          )}
        />
      </span>
    </label>
  );
}
