"use client";

import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  Loader2,
  Phone,
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
import { describeDays, describeWindows } from "@/lib/dialer/schedule";
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
  isSuperadmin = false,
  hasAiPermission = false,
  platformPool = [],
  platformRotateEvery = 1,
  platformPoolLocked = false,
}: {
  org: OrgFull;
  canDelete: boolean;
  isSuperadmin?: boolean;
  hasAiPermission?: boolean;
  platformPool?: string[];
  platformRotateEvery?: number;
  platformPoolLocked?: boolean;
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
  const [automation, setAutomation] = useState<OrgSettings["automation"]>(
    org.settings.automation,
  );
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
          {platformPoolLocked && !isSuperadmin ? (
            /* Non-superadmin sees the platform pool as read-only. */
            <div className="rounded-xl border border-border bg-muted/30 p-4">
              <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                <Lock className="h-3.5 w-3.5" />
                920 is the only active caller ID right now
              </p>
              <div className="space-y-1">
                {platformPool.map((n) => (
                  <div key={n} className="flex items-center gap-2 text-sm">
                    <Phone className="h-3.5 w-3.5 text-primary" />
                    <span className="font-mono">{n}</span>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Other numbers are under construction while we finish routing them — dialing
                stays on 920 for every org until then. Contact{" "}
                <span className="font-semibold">anasupalle17@gmail.com</span> to add numbers
                back once they're ready.
              </p>
            </div>
          ) : (
            /* Superadmin or no platform lock — fully editable. */
            <>
              {isSuperadmin && platformPoolLocked && (
                <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
                  <Lock className="h-3.5 w-3.5" />
                  Only 920 is live platform-wide (TWILIO_CALLER_IDS env var) — other numbers
                  are under construction. Org-level overrides are ignored until this is
                  lifted; change TWILIO_CALLER_IDS in Vercel to add numbers back.
                </p>
              )}
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
                One E.164 number per line. The dialer cycles through these for both manual and AI
                calls, switching every{" "}
                <span className="font-semibold tabular">
                  {Math.max(1, dialing.rotateEvery || 1)}
                </span>{" "}
                call{(dialing.rotateEvery || 1) === 1 ? "" : "s"}. Leave empty to always use the
                single Caller ID above.
              </p>
            </>
          )}
        </div>
        <div className="mt-3 space-y-3">
          <Toggle
            label="Local presence"
            hint="Dial from a pool number matching the lead's area code when one is available — looks local, lifts pickup. Falls back to rotation otherwise. Add numbers in the area codes you call most."
            checked={dialing.localPresence ?? false}
            onChange={(v) => setDialing({ ...dialing, localPresence: v })}
          />
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

      {/* Automated (unattended) AI calling */}
      <SectionCard
        title="Automated calling"
        description="Let the AI agent place calls on a schedule — no rep or open browser required. Requires the AI agent + a deployed cron (see docs)."
      >
        <Toggle
          label="Enable automated calling"
          hint="When on, the server places AI calls to your dialable leads during the windows below."
          checked={automation.enabled}
          onChange={(v) => setAutomation({ ...automation, enabled: v })}
        />

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Timezone" className="sm:col-span-3">
            <Input
              value={automation.timezone}
              placeholder="America/Chicago"
              onChange={(e) => setAutomation({ ...automation, timezone: e.target.value })}
            />
          </Field>
          <NumberField
            label="Calls per minute"
            value={automation.callsPerRun}
            onChange={(n) =>
              setAutomation({ ...automation, callsPerRun: Math.max(1, Math.min(30, n)) })
            }
          />
          <NumberField
            label="Daily cap (0 = none)"
            value={automation.dailyCap}
            onChange={(n) => setAutomation({ ...automation, dailyCap: Math.max(0, n) })}
          />
          <NumberField
            label="Re-dial cooldown (hrs)"
            value={automation.cooldownHours}
            onChange={(n) => setAutomation({ ...automation, cooldownHours: Math.max(0, n) })}
          />
        </div>

        <div className="mt-4">
          <Label>Calling days</Label>
          <div className="flex flex-wrap gap-1.5">
            {DAYS.map((d, i) => {
              const on = automation.days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    setAutomation({
                      ...automation,
                      days: on
                        ? automation.days.filter((x) => x !== i)
                        : [...automation.days, i].sort((a, b) => a - b),
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

        <div className="mt-4">
          <Label>Call windows (24-hour, end is exclusive)</Label>
          <div className="space-y-2">
            {automation.windows.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="w-20"
                  type="number"
                  min={0}
                  max={23}
                  value={w.start}
                  onChange={(e) => {
                    const start = Math.max(0, Math.min(23, Number(e.target.value) || 0));
                    setAutomation({
                      ...automation,
                      windows: automation.windows.map((x, j) => (j === i ? { ...x, start } : x)),
                    });
                  }}
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  className="w-20"
                  type="number"
                  min={1}
                  max={24}
                  value={w.end}
                  onChange={(e) => {
                    const end = Math.max(1, Math.min(24, Number(e.target.value) || 1));
                    setAutomation({
                      ...automation,
                      windows: automation.windows.map((x, j) => (j === i ? { ...x, end } : x)),
                    });
                  }}
                />
                <button
                  type="button"
                  aria-label="Remove window"
                  onClick={() =>
                    setAutomation({
                      ...automation,
                      windows: automation.windows.filter((_, j) => j !== i),
                    })
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted/60"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setAutomation({
                  ...automation,
                  windows: [...automation.windows, { start: 9, end: 10 }],
                })
              }
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted/60"
            >
              <Plus className="h-4 w-4" />
              Add window
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Calls{" "}
            <span className="font-semibold text-foreground">{describeDays(automation.days)}</span>{" "}
            at{" "}
            <span className="font-semibold text-foreground">
              {describeWindows(automation.windows)}
            </span>{" "}
            ({automation.timezone}). Keep windows inside 8am–9pm local to stay TCPA-compliant.
          </p>
        </div>

        <div className="mt-4 flex justify-end">
          <SaveBtn
            k="automation"
            onClick={() => save({ settings: { automation } }, "automation")}
          />
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
        {!features.aiDialer || !hasAiPermission ? (
          /* Locked when the org has aiDialer off (premium gate) or the viewer lacks dialer.ai */
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border/70 px-6 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-muted/40">
              <Lock className="h-6 w-6 text-muted-foreground" />
            </span>
            <div>
              <p className="text-sm font-semibold">
                {!features.aiDialer ? "AI calling — Premium Feature" : "AI calling is not enabled for your organization"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {!features.aiDialer ? (
                  <>
                    Your organization does not have access to AI calling. Contact{" "}
                    <span className="font-semibold text-foreground">anasupalle17@gmail.com</span> to
                    unlock AI calling for your account.
                  </>
                ) : (
                  <>
                    AI agent configuration requires the <span className="font-semibold">AI Dialer</span>{" "}
                    permission. Contact your organization owner or platform administrator to unlock AI
                    calling for this account.
                  </>
                )}
              </p>
            </div>
          </div>
        ) : (
          <>
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
          </>
        )}
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
