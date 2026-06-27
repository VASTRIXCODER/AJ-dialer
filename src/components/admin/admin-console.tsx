"use client";

import {
  Ban,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Database,
  History,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  Settings2,
  Shield,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CsvImport } from "@/components/leads/csv-import";
import { OrgSettingsForm } from "@/components/admin/org-settings-form";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Member, OrgCompany, OrgFull } from "@/lib/org/membership";
import {
  PERMISSIONS,
  PERMISSION_LABEL,
  type OrgRole,
  ROLE_LABEL,
  ROLE_RANK,
  assignableRoles,
  can,
} from "@/lib/permissions";
import { cn, initials, relativeTime } from "@/lib/utils";

type Tab = "members" | "organization" | "companies" | "activity" | "data";

type Integration = { name: string; ok: boolean; detail: string };

type AuditEntry = {
  id: string;
  action: string;
  actorName: string;
  targetName: string | null;
  targetKind: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

const roleTone: Record<OrgRole, "primary" | "accent" | "neutral" | "success"> = {
  owner: "success",
  admin: "primary",
  manager: "accent",
  rep: "neutral",
};

export function AdminConsole({
  org,
  role,
  permissions,
  members,
  companies,
  leadStats,
  integrations,
  audit,
  demo,
  isSuperadmin = false,
  platformPool = [],
  platformRotateEvery = 1,
  platformPoolLocked = false,
}: {
  org: OrgFull;
  role: OrgRole;
  permissions: string[];
  members: Member[];
  companies: OrgCompany[];
  leadStats: { total: number; qualified: number; appointments: number; avgScore: number };
  integrations: Integration[];
  audit: AuditEntry[];
  demo: boolean;
  isSuperadmin?: boolean;
  platformPool?: string[];
  platformRotateEvery?: number;
  platformPoolLocked?: boolean;
}) {
  const has = (p: string) => permissions.includes(p);

  const TABS: { key: Tab; label: string; icon: typeof Users; show: boolean }[] = [
    { key: "members", label: "Members", icon: Users, show: has("members.view") },
    { key: "organization", label: "Organization", icon: Settings2, show: has("org.edit") },
    { key: "companies", label: "Companies", icon: Building2, show: has("companies.manage") },
    { key: "activity", label: "Activity log", icon: History, show: has("members.view") },
    { key: "data", label: "Data & integrations", icon: Database, show: true },
  ];
  const visible = TABS.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(visible[0]?.key ?? "data");

  return (
    <div className="space-y-5">
      {demo && (
        <p className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-2.5 text-sm text-warning">
          Demo mode — connect Supabase &amp; a service role to manage real members
          and persist organization settings.
        </p>
      )}

      <div className="flex flex-wrap gap-1 border-b border-border">
        {visible.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={cn(
                "flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                active
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === "members" && (
        <MembersTab org={org} role={role} permissions={permissions} members={members} />
      )}
      {tab === "organization" && (
        <OrgSettingsForm
          org={org}
          canDelete={has("org.delete")}
          isSuperadmin={isSuperadmin}
          hasAiPermission={has("dialer.ai") && org.settings?.features?.aiDialer !== false}
          platformPool={platformPool}
          platformRotateEvery={platformRotateEvery}
          platformPoolLocked={platformPoolLocked}
        />
      )}
      {tab === "companies" && (
        <CompaniesTab companies={companies} />
      )}
      {tab === "activity" && <ActivityTab entries={audit} />}
      {tab === "data" && (
        <DataTab integrations={integrations} leadStats={leadStats} canImport={has("leads.import")} />
      )}
    </div>
  );
}

// ── Members ──────────────────────────────────────────────────────────────────
function MembersTab({
  org,
  role,
  permissions,
  members,
}: {
  org: OrgFull;
  role: OrgRole;
  permissions: string[];
  members: Member[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  const pending = members.filter((m) => m.status === "pending");
  const active = members.filter((m) => m.status === "active");
  const canApprove = permissions.includes("members.approve");
  const canRole = permissions.includes("members.role");
  const canRemove = permissions.includes("members.remove");
  // Roles a manager may assign on approval (always includes Rep; never owner).
  const approveChoices = assignableRoles(role);
  const [approveRole, setApproveRole] = useState<Record<string, OrgRole>>({});

  async function act(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setErr("");
    try {
      const res = await fetch("/api/org/members", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) setErr(j.error ?? "Action failed.");
      else router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  }

  function copyInvite() {
    const text = `Join ${org.name} on the AI dialer. Sign up, then enter join code ${org.joinCode}.`;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-4">
      {err && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{err}</p>
      )}

      {/* Invite / join code */}
      {permissions.includes("members.invite") && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface/40 p-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
            <KeyRound className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Invite teammates</p>
            <p className="text-xs text-muted-foreground">
              Share the join code{" "}
              <span className="font-mono font-bold tracking-widest">{org.joinCode}</span> — they’ll
              appear here to approve.
            </p>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={copyInvite}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "Copied" : "Copy invite"}
          </Button>
        </div>
      )}

      {/* Join requests */}
      {pending.length > 0 && (
        <SectionCard
          title={`Join requests (${pending.length})`}
          description="People who requested to join — classify their role, then approve."
        >
          <div className="space-y-2">
            {pending.map((m) => {
              const chosen = approveRole[m.id] ?? "rep";
              return (
                <div
                  key={m.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 p-3"
                >
                  <Avatar initials={initials(m.name || m.email)} color="#f59e0b" size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{m.name || m.email}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {m.email} · requested {relativeTime(m.requestedAt)}
                    </p>
                  </div>
                  {canApprove ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        Role
                        <select
                          value={chosen}
                          disabled={busy === m.id}
                          onChange={(e) =>
                            setApproveRole((s) => ({
                              ...s,
                              [m.id]: e.target.value as OrgRole,
                            }))
                          }
                          className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-semibold capitalize outline-none focus-visible:border-primary/50"
                        >
                          {approveChoices.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <Button
                        size="sm"
                        variant="success"
                        className="gap-1.5"
                        disabled={busy === m.id}
                        onClick={() =>
                          act({ id: m.id, action: "approve", role: chosen }, m.id)
                        }
                      >
                        {busy === m.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <UserCheck className="h-3.5 w-3.5" />
                        )}
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={busy === m.id}
                        onClick={() => act({ id: m.id, action: "reject" }, m.id)}
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Reject
                      </Button>
                    </div>
                  ) : (
                    <Badge tone="warning">Awaiting a manager</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </SectionCard>
      )}

      {/* Active members */}
      <SectionCard
        title={`Members (${active.length})`}
        description="Everyone with access to this organization."
      >
        <div className="space-y-2">
          {active.map((m) => (
            <MemberRow
              key={m.id}
              m={m}
              actorRole={role}
              canRole={canRole}
              canRemove={canRemove}
              canTransfer={role === "owner"}
              busy={busy === m.id}
              onRole={(r) => act({ id: m.id, action: "role", role: r }, m.id)}
              onPerms={(perms) => act({ id: m.id, action: "permissions", permissions: perms }, m.id)}
              onRemove={() => {
                if (confirm(`Remove ${m.name || m.email} from ${org.name}?`))
                  act({ id: m.id, action: "remove" }, m.id);
              }}
              onTransfer={() => {
                if (
                  confirm(
                    `Make ${m.name || m.email} the owner of ${org.name}? You'll be demoted to admin.`,
                  )
                )
                  act({ id: m.id, action: "transfer" }, m.id);
              }}
            />
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

function MemberRow({
  m,
  actorRole,
  canRole,
  canRemove,
  canTransfer,
  busy,
  onRole,
  onPerms,
  onRemove,
  onTransfer,
}: {
  m: Member;
  actorRole: OrgRole;
  canRole: boolean;
  canRemove: boolean;
  canTransfer: boolean;
  busy: boolean;
  onRole: (role: OrgRole) => void;
  onPerms: (perms: Record<string, boolean>) => void;
  onRemove: () => void;
  onTransfer: () => void;
}) {
  const [editing, setEditing] = useState(false);
  // You can only manage members strictly below your own rank, and never the owner.
  const manageable = m.role !== "owner" && ROLE_RANK[actorRole] > ROLE_RANK[m.role];
  const roleChoices = assignableRoles(actorRole);

  return (
    <div className="rounded-xl border border-border">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <Avatar initials={initials(m.name || m.email)} color="#0EA5E9" size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{m.name || m.email}</p>
          <p className="truncate text-xs text-muted-foreground">{m.email}</p>
        </div>
        <Badge tone={roleTone[m.role]} className="capitalize">
          {ROLE_LABEL[m.role]}
        </Badge>
        {canRole && manageable ? (
          <select
            value={m.role}
            disabled={busy}
            onChange={(e) => onRole(e.target.value as OrgRole)}
            className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-semibold capitalize outline-none focus-visible:border-primary/50"
          >
            {roleChoices.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        ) : null}
        {canRole && manageable && (
          <button
            type="button"
            aria-label="Edit permissions"
            onClick={() => setEditing((v) => !v)}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              editing && "bg-primary-soft text-primary",
            )}
          >
            <Shield className="h-4 w-4" />
          </button>
        )}
        {canTransfer && m.role !== "owner" && (
          <button
            type="button"
            aria-label="Transfer ownership"
            title="Transfer ownership"
            onClick={onTransfer}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-warning/10 hover:text-warning"
          >
            <Crown className="h-4 w-4" />
          </button>
        )}
        {canRemove && manageable && (
          <button
            type="button"
            aria-label="Remove member"
            onClick={onRemove}
            disabled={busy}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </button>
        )}
      </div>

      {editing && (
        <PermissionsEditor member={m} onSave={(perms) => { onPerms(perms); setEditing(false); }} />
      )}
    </div>
  );
}

function PermissionsEditor({
  member,
  onSave,
}: {
  member: Member;
  onSave: (perms: Record<string, boolean>) => void;
}) {
  // Effective state for each permission (role default OR override).
  const [state, setState] = useState<Record<string, boolean>>(() => {
    const s: Record<string, boolean> = {};
    for (const p of PERMISSIONS) s[p] = can(member.role, p, member.permissions);
    return s;
  });

  function commit() {
    // Only persist values that DIFFER from the role default, as overrides.
    const overrides: Record<string, boolean> = {};
    for (const p of PERMISSIONS) {
      const def = can(member.role, p);
      if (state[p] !== def) overrides[p] = state[p];
    }
    onSave(overrides);
  }

  return (
    <div className="border-t border-border bg-muted/30 p-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        <ShieldCheck className="h-3.5 w-3.5" />
        Permission overrides
      </p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {PERMISSIONS.map((p) => {
          const on = state[p];
          const isDefault = on === can(member.role, p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => setState((s) => ({ ...s, [p]: !s[p] }))}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                on
                  ? "border-primary/40 bg-primary-soft text-foreground"
                  : "border-border bg-surface/50 text-muted-foreground hover:bg-muted/60",
              )}
            >
              <span
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                  on ? "border-primary bg-primary text-white" : "border-border",
                )}
              >
                {on && <Check className="h-3 w-3" />}
              </span>
              <span className="flex-1">{PERMISSION_LABEL[p]}</span>
              {!isDefault && <span className="text-[10px] font-bold text-primary">●</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" className="gap-1.5" onClick={commit}>
          <CheckCircle2 className="h-3.5 w-3.5" />
          Apply
        </Button>
      </div>
    </div>
  );
}

// ── Companies ────────────────────────────────────────────────────────────────
function CompaniesTab({ companies }: { companies: OrgCompany[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  async function add() {
    if (!name.trim()) return;
    setBusy("add");
    setErr("");
    try {
      const res = await fetch("/api/org/companies", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) setErr(j.error ?? "Could not add company.");
      else {
        setName("");
        router.refresh();
      }
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/org/companies?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) setErr(j.error ?? "Could not remove.");
      else router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <SectionCard
      title="Companies & teams"
      description="Sub-groups within your organization."
    >
      {err && (
        <p className="mb-3 rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
          {err}
        </p>
      )}
      <div className="flex gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New company / team name"
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <Button className="shrink-0 gap-1.5" disabled={busy === "add" || !name.trim()} onClick={add}>
          {busy === "add" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          Add
        </Button>
      </div>
      <div className="mt-3 space-y-2">
        {companies.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
            No companies yet. Add one to organize members into teams.
          </p>
        ) : (
          companies.map((c) => (
            <div
              key={c.id}
              className="flex items-center gap-3 rounded-xl border border-border p-3"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Building2 className="h-4 w-4" />
              </span>
              <span className="flex-1 truncate text-sm font-semibold">{c.name}</span>
              <button
                type="button"
                aria-label="Remove company"
                disabled={busy === c.id}
                onClick={() => remove(c.id)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
              >
                {busy === c.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <X className="h-4 w-4" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </SectionCard>
  );
}

// ── Activity log ─────────────────────────────────────────────────────────────
const ACTION_LABEL: Record<string, string> = {
  "member.approve": "approved",
  "member.role": "changed the role of",
  "member.remove": "removed",
  "member.transfer_ownership": "transferred ownership to",
  "platform.grant": "granted platform access to",
  "platform.revoke": "revoked platform access from",
  "account.suspend": "suspended",
  "account.restore": "restored",
};

function ActivityTab({ entries }: { entries: AuditEntry[] }) {
  return (
    <SectionCard
      title="Activity log"
      description="Recent sensitive actions — role changes, approvals, removals & ownership transfers."
    >
      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
          No recorded activity yet.
        </p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => {
            const verb = ACTION_LABEL[e.action] ?? e.action.replace(/[._]/g, " ");
            const role = typeof e.detail?.role === "string" ? (e.detail.role as string) : null;
            return (
              <div key={e.id} className="flex items-start gap-3 rounded-xl border border-border p-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <History className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug">
                    <span className="font-semibold">{e.actorName}</span>{" "}
                    <span className="text-muted-foreground">{verb}</span>
                    {e.targetName && <span className="font-semibold"> {e.targetName}</span>}
                    {role && <span className="capitalize text-muted-foreground"> · {role}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {e.createdAt ? relativeTime(e.createdAt) : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}

// ── Data & integrations ──────────────────────────────────────────────────────
function DataTab({
  integrations,
  leadStats,
  canImport,
}: {
  integrations: Integration[];
  leadStats: { total: number; qualified: number; appointments: number; avgScore: number };
  canImport: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <SectionCard
        title="Integrations"
        description="Connection health"
        className="lg:col-span-1"
      >
        <div className="space-y-3">
          {integrations.map((it) => (
            <div
              key={it.name}
              className="flex items-start gap-3 rounded-xl border border-border p-3"
            >
              {it.ok ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
              ) : (
                <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{it.name}</p>
                <p className="text-xs text-muted-foreground">{it.detail}</p>
              </div>
              <Badge tone={it.ok ? "success" : "warning"}>{it.ok ? "Connected" : "Off"}</Badge>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Import leads"
        description={`${leadStats.total.toLocaleString()} leads in your account`}
        className="lg:col-span-2"
      >
        {canImport ? (
          <CsvImport variant="dropzone" />
        ) : (
          <p className="flex items-center gap-2 rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
            <Plug className="h-4 w-4" />
            You don’t have permission to import leads.
          </p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          {[
            ["Total", leadStats.total],
            ["Qualified", leadStats.qualified],
            ["Appointments", leadStats.appointments],
            ["Avg AI score", leadStats.avgScore],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl bg-muted p-3">
              <p className="text-lg font-bold tabular">{value}</p>
              <p className="text-[11px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
