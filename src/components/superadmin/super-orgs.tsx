"use client";

import {
  AlertTriangle,
  Ban,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserCheck,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Portal } from "@/components/ui/portal";
import type { OrgBilling, OrgBlueprint, OrgFeatures } from "@/lib/org/settings";
import { DIALER_TEMPLATES, templateLabel } from "@/lib/org/templates";
import { ROLE_LABEL } from "@/lib/permissions";
import { cn, initials } from "@/lib/utils";

export type Org = {
  id: string;
  name: string;
  slug: string;
  industry: string;
  status: "active" | "suspended";
  createdAt: string;
  companyCount: number;
  memberCount: number;
  pendingCount: number;
  joinCode: string;
  dialerTemplate: string;
  productName: string;
  brandColor: string;
  requireApproval: boolean;
  allowJoin: boolean;
};

type OrgDetail = Org & {
  description: string;
  tagline: string;
  website: string;
  accentColor: string;
  defaultRole: string;
  timezone: string;
  settings: {
    features: OrgFeatures;
    billing: OrgBilling;
    leadNoun: string;
    leadNounPlural: string;
  };
};
type OrgMember = {
  id: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  status: string;
  requestedAt: string;
  createdAt: string;
};
type Company = { id: string; orgId: string; name: string; createdAt: string };

async function api(method: string, body?: unknown, query = "") {
  const res = await fetch(`/api/superadmin/orgs${query}`, {
    method,
    headers: { "content-type": "application/json" },
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body),
  });
  return res.json().catch(() => ({}));
}

export function OrganizationsTab({
  orgs,
  onChanged,
}: {
  orgs: Org[];
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function setStatus(o: Org, status: "active" | "suspended") {
    setBusy(o.id);
    setErr("");
    const j = await api("PATCH", { id: o.id, status });
    setBusy(null);
    if (j.ok) onChanged();
    else setErr(j.error ?? "Failed.");
  }
  async function remove(o: Org) {
    if (!confirm(`Delete ${o.name}? Members are unassigned.`)) return;
    setBusy(o.id);
    const j = await api("DELETE", undefined, `?id=${encodeURIComponent(o.id)}`);
    setBusy(null);
    if (j.ok) {
      if (expanded === o.id) setExpanded(null);
      onChanged();
    } else setErr(j.error ?? "Failed.");
  }

  return (
    <div className="space-y-4">
      {err && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{err}</p>
      )}

      <SectionCard
        title="Provision an organization"
        description="Spin up a new tenant — instantly, or let the AI white-label it."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button className="gap-2" onClick={() => setWizard(true)}>
            <Wand2 className="h-4 w-4" />
            Build with AI
          </Button>
          <QuickCreate onChanged={onChanged} />
        </div>
      </SectionCard>

      <div className="space-y-2">
        {orgs.map((o) => (
          <div key={o.id} className="overflow-hidden rounded-2xl border border-border/60 surface-glass">
            <div className="flex flex-wrap items-center gap-3 p-4">
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-soft"
                style={{
                  background: o.brandColor
                    ? `linear-gradient(135deg, ${o.brandColor}, ${o.brandColor}cc)`
                    : "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))",
                }}
              >
                <Building2 className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{o.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {templateLabel(o.dialerTemplate)} · {o.memberCount} members ·{" "}
                  {o.companyCount} companies
                </p>
              </div>
              {o.pendingCount > 0 && (
                <Badge tone="warning">{o.pendingCount} pending</Badge>
              )}
              <Badge tone={o.status === "active" ? "success" : "warning"} className="capitalize">
                {o.status}
              </Badge>
              <code className="rounded bg-muted px-2 py-1 text-xs font-bold tracking-widest">
                {o.joinCode}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setStatus(o, o.status === "active" ? "suspended" : "active")}
                disabled={busy === o.id}
              >
                {o.status === "active" ? "Suspend" : "Activate"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setExpanded(expanded === o.id ? null : o.id)}
              >
                Manage
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", expanded === o.id && "rotate-180")}
                />
              </Button>
              <button
                type="button"
                aria-label="Delete organization"
                disabled={busy === o.id}
                onClick={() => remove(o)}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            {expanded === o.id && <OrgDrawer orgId={o.id} onChanged={onChanged} />}
          </div>
        ))}
      </div>

      {wizard && (
        <AIWizard
          onClose={() => setWizard(false)}
          onCreated={() => {
            setWizard(false);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function QuickCreate({ onChanged }: { onChanged: () => void }) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Quick create — name"
        className="min-w-[160px] flex-1"
      />
      <Input
        value={industry}
        onChange={(e) => setIndustry(e.target.value)}
        placeholder="Industry"
        className="min-w-[120px] flex-1"
      />
      <Button
        variant="outline"
        className="gap-1.5"
        disabled={busy || !name.trim()}
        onClick={async () => {
          setBusy(true);
          const j = await api("POST", { action: "createOrg", name, industry });
          setBusy(false);
          if (j.ok) {
            setName("");
            setIndustry("");
            onChanged();
          }
        }}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Create
      </Button>
    </div>
  );
}

function OrgDrawer({ orgId, onChanged }: { orgId: string; onChanged: () => void }) {
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    const j = await api("GET", undefined, `?orgId=${encodeURIComponent(orgId)}`);
    setDetail(j.org ?? null);
    setMembers(j.members ?? []);
    setCompanies(j.companies ?? []);
    setLoading(false);
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  async function memberAction(action: string, id: string, role?: string) {
    setBusy(id);
    setErr("");
    const j = await api("POST", { action, id, role });
    setBusy(null);
    if (j.ok) {
      load();
      onChanged();
    } else setErr(j.error ?? "Failed.");
  }

  if (loading)
    return (
      <div className="flex items-center justify-center gap-2 border-t border-border/60 bg-muted/20 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading organization…
      </div>
    );

  if (!detail)
    return (
      <p className="border-t border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
        Could not load this organization.
      </p>
    );

  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");

  return (
    <div className="space-y-4 border-t border-border/60 bg-muted/20 p-4">
      {err && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{err}</p>
      )}

      <OrgEditor detail={detail} onSaved={() => { load(); onChanged(); }} />

      <OrgBillingEditor detail={detail} onSaved={() => { load(); onChanged(); }} />

      {/* Members */}
      <div className="rounded-xl border border-border bg-card p-4">
        <p className="mb-2 text-sm font-semibold">Members</p>
        {pending.length > 0 && (
          <div className="mb-3 space-y-1.5">
            {pending.map((m) => (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/5 p-2"
              >
                <Avatar initials={initials(m.name || m.email)} color="#f59e0b" size="xs" />
                <span className="min-w-0 flex-1 truncate text-sm">{m.email}</span>
                <Badge tone="warning">pending</Badge>
                <Button
                  size="sm"
                  variant="success"
                  className="gap-1"
                  disabled={busy === m.id}
                  onClick={() => memberAction("memberApprove", m.id)}
                >
                  <UserCheck className="h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === m.id}
                  onClick={() => memberAction("memberReject", m.id)}
                >
                  <Ban className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          {active.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
              <Avatar initials={initials(m.name || m.email)} color="#ef4444" size="xs" />
              <span className="min-w-0 flex-1 truncate text-sm">{m.name || m.email}</span>
              <select
                value={m.role}
                disabled={busy === m.id}
                onChange={(e) => memberAction("memberRole", m.id, e.target.value)}
                className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-semibold capitalize outline-none"
              >
                {(["owner", "admin", "manager", "rep"] as const).map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="Remove member"
                disabled={busy === m.id}
                onClick={() => memberAction("memberRemove", m.id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-danger/10 hover:text-danger"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {active.length === 0 && (
            <p className="text-sm text-muted-foreground">No active members.</p>
          )}
        </div>
      </div>

      {/* Companies */}
      <OrgCompanies orgId={orgId} companies={companies} onChanged={() => { load(); onChanged(); }} />
    </div>
  );
}

function OrgEditor({ detail, onSaved }: { detail: OrgDetail; onSaved: () => void }) {
  const [f, setF] = useState({
    name: detail.name,
    productName: detail.productName,
    tagline: detail.tagline,
    industry: detail.industry,
    dialerTemplate: detail.dialerTemplate,
    brandColor: detail.brandColor,
    accentColor: detail.accentColor,
    defaultRole: detail.defaultRole,
    requireApproval: detail.requireApproval,
    allowJoin: detail.allowJoin,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  async function save() {
    setBusy(true);
    const j = await api("PATCH", { id: detail.id, ...f });
    setBusy(false);
    if (j.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">Settings</p>
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(detail.joinCode);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs font-semibold"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {detail.joinCode}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Cell label="Name">
          <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </Cell>
        <Cell label="Product name">
          <Input value={f.productName} onChange={(e) => setF({ ...f, productName: e.target.value })} />
        </Cell>
        <Cell label="Tagline">
          <Input value={f.tagline} onChange={(e) => setF({ ...f, tagline: e.target.value })} />
        </Cell>
        <Cell label="Industry">
          <Input value={f.industry} onChange={(e) => setF({ ...f, industry: e.target.value })} />
        </Cell>
        <Cell label="Specialization">
          <Select value={f.dialerTemplate} onChange={(e) => setF({ ...f, dialerTemplate: e.target.value })}>
            {DIALER_TEMPLATES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Cell>
        <Cell label="Default role">
          <Select value={f.defaultRole} onChange={(e) => setF({ ...f, defaultRole: e.target.value })}>
            {(["rep", "manager", "admin"] as const).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Cell>
        <Cell label="Brand / accent">
          <div className="flex gap-2">
            <input
              type="color"
              value={f.brandColor || "#dc2626"}
              onChange={(e) => setF({ ...f, brandColor: e.target.value })}
              className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-background"
              aria-label="Brand color"
            />
            <input
              type="color"
              value={f.accentColor || "#f97316"}
              onChange={(e) => setF({ ...f, accentColor: e.target.value })}
              className="h-10 w-12 cursor-pointer rounded-lg border border-border bg-background"
              aria-label="Accent color"
            />
          </div>
        </Cell>
        <Cell label="Membership">
          <div className="flex flex-col gap-1.5 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.requireApproval}
                onChange={(e) => setF({ ...f, requireApproval: e.target.checked })}
              />
              Require approval
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={f.allowJoin}
                onChange={(e) => setF({ ...f, allowJoin: e.target.checked })}
              />
              Allow new members
            </label>
          </div>
        </Cell>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" className="gap-2" disabled={busy} onClick={save}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saved ? "Saved" : "Save settings"}
        </Button>
      </div>
    </div>
  );
}

function OrgBillingEditor({ detail, onSaved }: { detail: OrgDetail; onSaved: () => void }) {
  const b = detail.settings.billing;
  const [f, setF] = useState({
    paywall: b.paywall,
    active: b.active,
    price: b.price,
    currency: b.currency || "USD",
    interval: b.interval,
    note: b.note,
  });
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    const j = await api("PATCH", { id: detail.id, settings: { billing: f } });
    setBusy(false);
    if (j.ok) {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    }
  }

  const locked = f.paywall && !f.active;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">Billing &amp; paywall</p>
        <Badge tone={!f.paywall ? "neutral" : f.active ? "success" : "warning"}>
          {!f.paywall ? "Free" : f.active ? "Unlocked" : "Locked"}
        </Badge>
      </div>

      <div className="space-y-2.5">
        <label className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 text-sm">
          <span>
            <span className="font-medium">Require payment</span>
            <span className="block text-xs text-muted-foreground">
              Gate this workspace behind a paid plan.
            </span>
          </span>
          <input
            type="checkbox"
            checked={f.paywall}
            onChange={(e) => setF({ ...f, paywall: e.target.checked })}
          />
        </label>

        <label
          className={cn(
            "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm transition-colors",
            f.paywall ? "border-border bg-background/40" : "border-border/40 opacity-50",
          )}
        >
          <span>
            <span className="font-medium">Access unlocked (paid)</span>
            <span className="block text-xs text-muted-foreground">
              On = members get in. Off = they see the lock screen.
            </span>
          </span>
          <input
            type="checkbox"
            checked={f.active}
            disabled={!f.paywall}
            onChange={(e) => setF({ ...f, active: e.target.checked })}
          />
        </label>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Cell label="Price">
            <Input
              type="number"
              min={0}
              value={String(f.price)}
              onChange={(e) => setF({ ...f, price: Number(e.target.value) || 0 })}
            />
          </Cell>
          <Cell label="Currency">
            <Input
              value={f.currency}
              onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase().slice(0, 3) })}
            />
          </Cell>
          <Cell label="Billing period">
            <Select
              value={f.interval}
              onChange={(e) => setF({ ...f, interval: e.target.value as OrgBilling["interval"] })}
            >
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
              <option value="once">One-time</option>
            </Select>
          </Cell>
        </div>

        <Cell label="Lock-screen note (optional)">
          <Textarea
            value={f.note}
            onChange={(e) => setF({ ...f, note: e.target.value })}
            placeholder="e.g. Contact billing@yourcompany.com to activate."
            className="min-h-[64px]"
          />
        </Cell>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {locked ? "Members are currently locked out." : "Members have full access."}
        </p>
        <Button size="sm" className="gap-2" disabled={busy} onClick={save}>
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : saved ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saved ? "Saved" : "Save billing"}
        </Button>
      </div>
    </div>
  );
}

function OrgCompanies({
  orgId,
  companies,
  onChanged,
}: {
  orgId: string;
  companies: Company[];
  onChanged: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-2 text-sm font-semibold">Companies</p>
      <div className="flex gap-2">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="New company" />
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          disabled={busy === "add" || !name.trim()}
          onClick={async () => {
            setBusy("add");
            const j = await api("POST", { action: "createCompany", orgId, name });
            setBusy(null);
            if (j.ok) {
              setName("");
              onChanged();
            }
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {companies.map((c) => (
          <span
            key={c.id}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface/50 px-2.5 py-1 text-xs"
          >
            {c.name}
            <button
              type="button"
              aria-label="Remove"
              disabled={busy === c.id}
              onClick={async () => {
                setBusy(c.id);
                const j = await api("POST", { action: "deleteCompany", id: c.id });
                setBusy(null);
                if (j.ok) onChanged();
              }}
              className="text-muted-foreground hover:text-danger"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {companies.length === 0 && (
          <span className="text-sm text-muted-foreground">No companies.</span>
        )}
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

// ── AI wizard (superadmin) ───────────────────────────────────────────────────
function AIWizard({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [step, setStep] = useState<"describe" | "preview">("describe");
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bp, setBp] = useState<OrgBlueprint | null>(null);
  const [source, setSource] = useState<string | null>(null);

  async function generate() {
    setBusy(true);
    setErr("");
    const j = await api("POST", { action: "aiBuild", description, name, industry });
    setBusy(false);
    if (j.ok) {
      setBp(j.blueprint);
      setSource(j.source);
      setStep("preview");
    } else setErr(j.error ?? "Failed.");
  }
  async function create() {
    if (!bp) return;
    setBusy(true);
    const j = await api("POST", { action: "createFromBlueprint", blueprint: bp });
    setBusy(false);
    if (j.ok) onCreated();
    else setErr(j.error ?? "Failed.");
  }

  return (
    <Portal>
      <div className="superadmin-theme fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4">
        <div className="absolute inset-0 bg-background/70 backdrop-blur-xl" onClick={onClose} />
        <div className="glass relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border/60 shadow-lift sm:rounded-2xl">
          <div className="flex items-center justify-between border-b border-border/60 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-solar text-white shadow-glow">
                <Wand2 className="h-5 w-5" />
              </span>
              <p className="text-base font-semibold">AI organization builder</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            {step === "describe" ? (
              <>
                <div>
                  <Label>Describe the business</Label>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. A national pest-control franchise booking quarterly service visits."
                    className="min-h-[110px]"
                  />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Cell label="Name">
                    <Input value={name} onChange={(e) => setName(e.target.value)} />
                  </Cell>
                  <Cell label="Industry (optional)">
                    <Input value={industry} onChange={(e) => setIndustry(e.target.value)} />
                  </Cell>
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
                <Button variant="ghost" className="flex-1" type="button" onClick={() => setStep("describe")}>
                  Back
                </Button>
                <Button className="flex-1 gap-2" disabled={busy} onClick={create}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                  Create organization
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

function BlueprintPreview({
  bp,
  source,
  onChange,
}: {
  bp: OrgBlueprint;
  source: string | null;
  onChange: (bp: OrgBlueprint) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg bg-primary-soft/50 px-3 py-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        {source === "claude" ? "Designed by Claude." : "Designed with smart defaults."}
      </div>
      <div
        className="flex items-center gap-3 rounded-xl border border-border/60 p-4"
        style={{ background: `linear-gradient(135deg, ${bp.brandColor}22, transparent)` }}
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
        <Badge tone="primary">{templateLabel(bp.template)}</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Cell label="Name">
          <Input value={bp.name} onChange={(e) => onChange({ ...bp, name: e.target.value })} />
        </Cell>
        <Cell label="Product name">
          <Input value={bp.productName} onChange={(e) => onChange({ ...bp, productName: e.target.value })} />
        </Cell>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
          AI agent
        </p>
        <p className="text-sm font-semibold">{bp.settings.ai.agentName}</p>
        <p className="text-xs text-muted-foreground">{bp.settings.ai.persona}</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {bp.settings.dispositions.map((d, i) => (
          <span key={i} className="rounded-full border border-border bg-surface/50 px-2.5 py-0.5 text-xs">
            {d.label}
          </span>
        ))}
      </div>
    </div>
  );
}
