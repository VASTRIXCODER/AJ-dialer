"use client";

import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  Clock,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogoMark } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { Modal } from "@/components/ui/modal";
import type { OrgBlueprint, OrgFeatures } from "@/lib/org/settings";
import { DIALER_TEMPLATES, templateLabel, templatePlate } from "@/lib/org/templates";
import { ROLE_LABEL, type OrgRole } from "@/lib/permissions";

type Membership = {
  id: string;
  name: string;
  productName: string;
  tagline: string;
  industry: string;
  description: string;
  website: string;
  logoUrl: string;
  brandColor: string;
  dialerTemplate: string;
  role: OrgRole;
};
type Pending = { orgId: string; orgName: string; requireApproval: boolean };

const FEATURE_LABEL: Record<keyof OrgFeatures, string> = {
  aiDialer: "Power dialer",
  manualDialer: "Manual dialing",
  leads: "Leads",
  appointments: "Appointments",
  callbacks: "Callbacks",
  // Feature-flag list, shown before an org has a vertical — the neutral name.
  billsFine: "Set aside for later",
  liveMonitor: "Live monitor",
  leaderboard: "Leaderboard",
  campaigns: "Campaigns",
  reports: "Reports",
  aiAgent: "AI agent",
  crm: "CRM workspace",
};

function brandGradient(color: string) {
  return color
    ? `linear-gradient(135deg, ${color}, ${color}cc)`
    : "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))";
}

export function HubView({
  name,
  memberships,
  pending,
  aiConfigured,
  superadmin = false,
}: {
  name: string;
  memberships: Membership[];
  pending: Pending[];
  aiConfigured: boolean;
  superadmin?: boolean;
}) {
  const router = useRouter();
  const [entering, setEntering] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  async function enter(orgId: string) {
    setEntering(orgId);
    try {
      const res = await fetch("/api/org/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const j = await res.json().catch(() => ({}));
      if (j.ok) window.location.href = "/dashboard";
      else setEntering(null);
    } catch {
      setEntering(null);
    }
  }

  return (
    <div className="animate-fade-up space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <LogoMark className="h-11 w-11" />
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
              Welcome back, {name.split(" ")[0]}
            </h1>
            <p className="text-sm text-muted-foreground">
              Choose an organization to enter, or start a new one.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {superadmin && (
            <a
              href="/console"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Control Center
            </a>
          )}
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          </form>
        </div>
      </div>

      {/* Your organizations */}
      <section>
        <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
          Your organizations
        </h2>
        {memberships.length === 0 ? (
          <div className="surface-glass rounded-2xl border border-dashed border-border/70 p-8 text-center">
            <p className="text-sm text-muted-foreground">
              You’re not in any organization yet. Join one with a code or create a
              new one below.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {memberships.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => enter(m.id)}
                disabled={entering === m.id}
                className="surface-glass group flex flex-col overflow-hidden rounded-2xl border border-border/60 text-left shadow-soft transition-colors duration-200 hover:border-border"
              >
                {/* The workspace's vertical, as a Stage plate. The org picker is
                    a place a rep arrives and chooses, not one they work in, so
                    it is allowed to be cinematic — see templatePlate. */}
                <span
                  aria-hidden
                  className="block h-20 w-full bg-surface-2 bg-cover bg-center"
                  style={{ backgroundImage: `url(${templatePlate(m.dialerTemplate)})` }}
                />
                <span className="flex flex-1 flex-col p-5">
                <div className="flex items-center gap-3">
                  <span
                    className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-xl text-white shadow-soft"
                    style={{ background: brandGradient(m.brandColor) }}
                  >
                    {m.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={m.logoUrl}
                        alt=""
                        className="h-full w-full object-cover"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <Building2 className="h-5 w-5" />
                    )}
                  </span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">
                    {ROLE_LABEL[m.role]}
                  </span>
                  {m.industry ? (
                    <span className="truncate rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                      {m.industry}
                    </span>
                  ) : null}
                </div>
                <p className="mt-3 truncate text-base font-bold tracking-tight">{m.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {m.tagline || m.productName || templateLabel(m.dialerTemplate)}
                </p>
                {m.description ? (
                  <p className="mt-1.5 line-clamp-2 text-xs text-ink-3">
                    {m.description}
                  </p>
                ) : null}
                {m.website ? (
                  <p className="mt-1 truncate text-[11px] text-ink-3">
                    {m.website.replace(/^https?:\/\//, "")}
                  </p>
                ) : null}
                <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  {entering === m.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      Enter
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* Pending requests */}
      {pending.length > 0 && (
        <section>
          <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Pending requests
          </h2>
          <div className="space-y-2">
            {pending.map((p) => (
              <div
                key={p.orgId}
                className="surface-glass flex items-center gap-3 rounded-xl border border-warning/30 p-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/15 text-warning">
                  <Clock className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.orgName}</p>
                  <p className="text-xs text-muted-foreground">Awaiting manager approval</p>
                </div>
                <button
                  type="button"
                  onClick={() => router.refresh()}
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  Refresh
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Join + create. Creating a new org (the AI builder) is reserved for the
          platform superadmin; everyone else joins an existing org with a code. */}
      <section className={superadmin ? "grid grid-cols-1 gap-4 lg:grid-cols-2" : ""}>
        <JoinCard
          onJoinedActive={() => (window.location.href = "/dashboard")}
          onPending={() => router.refresh()}
        />
        {superadmin && (
          <div className="surface-glass flex flex-col rounded-2xl border border-border/60 p-6 shadow-soft">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white">
              <Wand2 className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-base font-bold tracking-tight">
              Create a new organization
            </h3>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">
              Describe your business and the AI will white-label the dialer for you —
              branding, AI agent, dispositions and features, all configured
              automatically.
            </p>
            <Button className="mt-4 gap-2 self-start" onClick={() => setWizardOpen(true)}>
              <Sparkles className="h-4 w-4" />
              Build with AI
            </Button>
          </div>
        )}
      </section>

      {superadmin && wizardOpen && (
        <AIBuilder aiConfigured={aiConfigured} onClose={() => setWizardOpen(false)} />
      )}
    </div>
  );
}

function JoinCard({
  onJoinedActive,
  onPending,
}: {
  onJoinedActive: () => void;
  onPending: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const res = await fetch("/api/org/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "Could not join.");
        return;
      }
      if (j.status === "active") onJoinedActive();
      else {
        setOk(`Request sent to ${j.orgName ?? "the organization"} — awaiting approval.`);
        setCode("");
        onPending();
      }
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="surface-glass flex flex-col rounded-2xl border border-border/60 p-6 shadow-soft"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <KeyRound className="h-5 w-5" />
      </span>
      <h3 className="mt-3 text-base font-bold tracking-tight">Join with a code</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Enter the join code your manager shared with you.
      </p>
      <div className="mt-4 flex gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="e.g. SUNRUN1"
          className="text-center font-bold uppercase tracking-[0.25em]"
          maxLength={12}
        />
        <Button type="submit" className="shrink-0 gap-1.5" disabled={busy || !code.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
          Join
        </Button>
      </div>
      {err && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-danger">
          <AlertTriangle className="h-4 w-4" />
          {err}
        </p>
      )}
      {ok && (
        <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-success">
          <Check className="h-4 w-4" />
          {ok}
        </p>
      )}
    </form>
  );
}

function AIBuilder({
  aiConfigured,
  onClose,
}: {
  aiConfigured: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState<"describe" | "preview">("describe");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [source, setSource] = useState<"claude" | "heuristic" | null>(null);
  const [bp, setBp] = useState<OrgBlueprint | null>(null);

  async function generate() {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/org/ai-build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description, name, industry }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "Could not generate.");
        return;
      }
      setBp(j.blueprint);
      setSource(j.source);
      setStep("preview");
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!bp) return;
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/org/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blueprint: bp }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setErr(j.error ?? "Could not create organization.");
        return;
      }
      window.location.href = "/dashboard";
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} label="AI organization builder" maxWidth="max-w-2xl">
      <div className="flex items-center justify-between border-b border-border/60 p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand text-white">
            <Wand2 className="h-5 w-5" />
          </span>
          <div>
            <p className="text-base font-semibold leading-tight">AI organization builder</p>
            <p className="text-xs text-muted-foreground">
              {aiConfigured
                ? "Claude designs your white-labeled dialer."
                : "Smart defaults design your dialer (add a Claude key for bespoke results)."}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {step === "describe" ? (
          <>
            <div>
              <Label>Describe your business</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. We're a residential roofing company in Texas. We call homeowners after storms to book free inspections and warranty claims."
                className="min-h-[120px]"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>Organization name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Apex Roofing"
                />
              </div>
              <div>
                <Label>Industry (optional)</Label>
                <Input
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  placeholder="Roofing / Home services"
                />
              </div>
            </div>
          </>
        ) : bp ? (
          <BlueprintPreview bp={bp} source={source} onChange={setBp} />
        ) : null}

        {err && (
          <p className="flex items-center gap-1.5 text-sm font-medium text-danger">
            <AlertTriangle className="h-4 w-4" />
            {err}
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-border/60 p-5">
        {step === "describe" ? (
          <>
            <Button variant="ghost" className="flex-1" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button
              className="flex-1 gap-2"
              disabled={busy || (!description.trim() && !name.trim())}
              onClick={generate}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Design it
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="flex-1"
              type="button"
              onClick={() => setStep("describe")}
            >
              Back
            </Button>
            <Button className="flex-1 gap-2" disabled={busy} onClick={create}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
              Create organization
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}

function BlueprintPreview({
  bp,
  source,
  onChange,
}: {
  bp: OrgBlueprint;
  source: "claude" | "heuristic" | null;
  onChange: (bp: OrgBlueprint) => void;
}) {
  const enabledFeatures = (Object.keys(bp.settings.features) as (keyof OrgFeatures)[]).filter(
    (k) => bp.settings.features[k],
  );
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg bg-primary-soft/50 px-3 py-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        {source === "claude"
          ? "Designed by Claude — review and tweak, then create."
          : "Designed with smart defaults — review and tweak, then create."}
      </div>

      {/* Brand preview */}
      <div
        className="flex items-center gap-3 rounded-xl border border-border/60 p-4"
        style={{
          background: `linear-gradient(135deg, ${bp.brandColor}22, transparent)`,
        }}
      >
        <span
          className="flex h-12 w-12 items-center justify-center rounded-xl text-white shadow-soft"
          style={{ background: `linear-gradient(135deg, ${bp.brandColor}, ${bp.accentColor})` }}
        >
          <Building2 className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold">{bp.productName || bp.name}</p>
          <p className="truncate text-xs text-muted-foreground">{bp.tagline}</p>
        </div>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">
          {templateLabel(bp.template)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Organization name</Label>
          <Input value={bp.name} onChange={(e) => onChange({ ...bp, name: e.target.value })} />
        </div>
        <div>
          <Label>Product name</Label>
          <Input
            value={bp.productName}
            onChange={(e) => onChange({ ...bp, productName: e.target.value })}
          />
        </div>
        <div>
          <Label>Specialization</Label>
          <SelectMenu
            label="Specialization"
            className="w-full"
            triggerClassName="w-full"
            value={bp.template}
            onChange={(v) => onChange({ ...bp, template: v })}
            options={DIALER_TEMPLATES.map((t) => ({ value: t.value, label: t.label }))}
          />
        </div>
        <div>
          <Label>Brand colors</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={bp.brandColor || "#2563eb"}
              onChange={(e) => onChange({ ...bp, brandColor: e.target.value })}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-background"
              aria-label="Brand color"
            />
            <input
              type="color"
              value={bp.accentColor || "#06b6d4"}
              onChange={(e) => onChange({ ...bp, accentColor: e.target.value })}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-border bg-background"
              aria-label="Accent color"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border/60 p-4">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          AI agent
        </p>
        <p className="mt-1 text-sm font-semibold">{bp.settings.ai.agentName}</p>
        <p className="text-xs text-muted-foreground">{bp.settings.ai.persona}</p>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Dispositions
        </p>
        <div className="flex flex-wrap gap-1.5">
          {bp.settings.dispositions.map((d, i) => (
            <span
              key={i}
              className="rounded-full border border-border bg-surface/50 px-2.5 py-0.5 text-xs"
            >
              {d.label}
            </span>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Enabled features
        </p>
        <div className="flex flex-wrap gap-1.5">
          {enabledFeatures.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary"
            >
              <Check className="h-3 w-3" />
              {FEATURE_LABEL[k]}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
