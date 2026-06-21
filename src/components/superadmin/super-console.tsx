"use client";

import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  LayoutDashboard,
  Loader2,
  LogOut,
  Plus,
  Power,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, initials, relativeTime } from "@/lib/utils";

type Settings = { maintenance: boolean; message: string };
type Account = {
  id: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  orgId: string | null;
  companyId: string | null;
};
type Org = {
  id: string;
  name: string;
  slug: string;
  industry: string;
  status: "active" | "suspended";
  createdAt: string;
  companyCount: number;
  memberCount: number;
};
type Company = { id: string; orgId: string; name: string; createdAt: string };

type Tab = "overview" | "organizations" | "accounts" | "control";

const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "organizations", label: "Organizations", icon: Building2 },
  { key: "accounts", label: "Accounts", icon: Users },
  { key: "control", label: "App Control", icon: Power },
];

export function SuperConsole() {
  const [tab, setTab] = useState<Tab>("overview");
  const [settings, setSettings] = useState<Settings>({ maintenance: false, message: "" });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    fetch("/api/superadmin/control")
      .then((r) => r.json())
      .then((j) => {
        if (j.settings) setSettings(j.settings);
        setAccounts(j.accounts ?? []);
        setOrgs(j.organizations ?? []);
        setCompanies(j.companies ?? []);
      })
      .catch(() => setErr("Could not load console data."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const control = useCallback(
    async (body: Record<string, unknown>, key: string) => {
      setBusy(key);
      setErr("");
      try {
        const res = await fetch("/api/superadmin/control", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.ok === false) setErr(j.error ?? "Action failed.");
        else load();
      } catch {
        setErr("Network error.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const orgApi = useCallback(
    async (method: "POST" | "PATCH" | "DELETE", body: Record<string, unknown>, key: string, query = "") => {
      setBusy(key);
      setErr("");
      try {
        const res = await fetch(`/api/superadmin/orgs${query}`, {
          method,
          headers: { "content-type": "application/json" },
          body: method === "DELETE" ? undefined : JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok || j.ok === false) setErr(j.error ?? "Action failed.");
        else load();
      } catch {
        setErr("Network error.");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  async function signOut() {
    await fetch("/api/superadmin/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  const suspended = accounts.filter((a) => a.disabled).length;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Reddish header */}
      <header className="border-b border-danger/30 bg-gradient-to-r from-danger/15 via-danger/5 to-transparent">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-danger text-danger-foreground shadow-[0_0_24px_-4px_hsl(var(--danger)/0.7)]">
            <ShieldAlert className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              Superadmin Console
              <Badge tone="danger">Overseer</Badge>
            </h1>
            <p className="text-xs text-muted-foreground">
              Manage every organization, company & account across the platform.
            </p>
          </div>
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
              settings.maintenance ? "bg-danger/15 text-danger" : "bg-success/12 text-success",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {settings.maintenance ? "App offline" : "App live"}
          </span>
          <Button variant="outline" size="sm" className="gap-2" onClick={signOut}>
            <LogOut className="h-4 w-4" />
            Exit
          </Button>
        </div>

        {/* Tabs */}
        <div className="mx-auto max-w-7xl px-2 sm:px-5">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const active = tab === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
                    active
                      ? "border-danger text-danger"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        {err && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{err}</p>
        )}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading console…
          </div>
        ) : (
          <>
            {tab === "overview" && (
              <Overview
                orgs={orgs}
                companies={companies}
                accounts={accounts}
                suspended={suspended}
                settings={settings}
                busy={busy}
                onMaintenance={(on, message) =>
                  control({ action: "maintenance", on, message }, "maint")
                }
                onGoto={setTab}
              />
            )}
            {tab === "organizations" && (
              <OrganizationsTab
                orgs={orgs}
                companies={companies}
                accounts={accounts}
                busy={busy}
                onCreateOrg={(name, industry) =>
                  orgApi("POST", { action: "createOrg", name, industry }, "createOrg")
                }
                onSetStatus={(id, status) => orgApi("PATCH", { id, status }, id)}
                onDeleteOrg={(id) => orgApi("DELETE", {}, id, `?id=${encodeURIComponent(id)}`)}
                onAddCompany={(orgId, name) =>
                  orgApi("POST", { action: "createCompany", orgId, name }, `c-${orgId}`)
                }
                onDeleteCompany={(id) =>
                  orgApi("POST", { action: "deleteCompany", id }, `dc-${id}`)
                }
              />
            )}
            {tab === "accounts" && (
              <AccountsTab
                accounts={accounts}
                orgs={orgs}
                companies={companies}
                busy={busy}
                onAssign={(id, orgId, companyId) =>
                  control({ action: "assign", id, orgId, companyId }, `as-${id}`)
                }
                onToggle={(id, disabled) =>
                  control({ action: disabled ? "enable" : "disable", id }, id)
                }
                onDelete={(id) => control({ action: "delete", id }, `del-${id}`)}
              />
            )}
            {tab === "control" && (
              <AppControlTab
                settings={settings}
                busy={busy}
                onMaintenance={(on, message) =>
                  control({ action: "maintenance", on, message }, "maint")
                }
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function Stat({
  icon: Icon,
  label,
  value,
  tone = "danger",
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  tone?: "danger" | "success" | "warning" | "neutral";
}) {
  const tones = {
    danger: "bg-danger/12 text-danger",
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning",
    neutral: "bg-muted text-muted-foreground",
  } as const;
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-4">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tabular">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function Overview({
  orgs,
  companies,
  accounts,
  suspended,
  settings,
  busy,
  onMaintenance,
  onGoto,
}: {
  orgs: Org[];
  companies: Company[];
  accounts: Account[];
  suspended: number;
  settings: Settings;
  busy: string | null;
  onMaintenance: (on: boolean, message: string) => void;
  onGoto: (t: Tab) => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat icon={Building2} label="Organizations" value={orgs.length} />
        <Stat icon={Building2} label="Companies" value={companies.length} tone="neutral" />
        <Stat icon={Users} label="Accounts" value={accounts.length} tone="success" />
        <Stat icon={Ban} label="Suspended" value={suspended} tone="warning" />
        <Stat
          icon={Power}
          label="App status"
          value={settings.maintenance ? "Offline" : "Live"}
          tone={settings.maintenance ? "danger" : "success"}
        />
      </div>

      <div className="rounded-2xl border border-danger/30 bg-danger/5 p-5">
        <div className="flex items-center gap-2">
          <Power className="h-4 w-4 text-danger" />
          <h2 className="text-lg font-semibold">Global kill switch</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Instantly take the whole product offline for every account (you keep
          access). Manage details in App Control.
        </p>
        <div className="mt-3">
          {settings.maintenance ? (
            <Button variant="success" className="gap-2" disabled={busy === "maint"} onClick={() => onMaintenance(false, settings.message)}>
              {busy === "maint" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Resume app
            </Button>
          ) : (
            <Button variant="danger" className="gap-2" disabled={busy === "maint"} onClick={() => onMaintenance(true, settings.message)}>
              {busy === "maint" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              Shut down app
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border/60 bg-card p-5">
        <h2 className="text-lg font-semibold">Organizations</h2>
        <p className="text-sm text-muted-foreground">Each is a specialization of the dialer.</p>
        <div className="mt-3 space-y-2">
          {orgs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No organizations yet. (Run the schema; Sunrun is seeded.)
            </p>
          ) : (
            orgs.map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-danger/10 text-danger">
                  <Building2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{o.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{o.industry || "—"}</p>
                </div>
                <span className="text-xs text-muted-foreground">{o.companyCount} companies</span>
                <span className="text-xs text-muted-foreground">{o.memberCount} members</span>
                <Badge tone={o.status === "active" ? "success" : "warning"} className="capitalize">
                  {o.status}
                </Badge>
              </div>
            ))
          )}
        </div>
        <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={() => onGoto("organizations")}>
          <Building2 className="h-4 w-4" />
          Manage organizations
        </Button>
      </div>
    </div>
  );
}

// ── Organizations ──────────────────────────────────────────────────────────────
function OrganizationsTab({
  orgs,
  companies,
  accounts,
  busy,
  onCreateOrg,
  onSetStatus,
  onDeleteOrg,
  onAddCompany,
  onDeleteCompany,
}: {
  orgs: Org[];
  companies: Company[];
  accounts: Account[];
  busy: string | null;
  onCreateOrg: (name: string, industry: string) => void;
  onSetStatus: (id: string, status: string) => void;
  onDeleteOrg: (id: string) => void;
  onAddCompany: (orgId: string, name: string) => void;
  onDeleteCompany: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");

  const field =
    "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-danger/50 focus-visible:ring-2 focus-visible:ring-danger/15";

  return (
    <div className="space-y-5">
      {/* Create */}
      <div className="rounded-2xl border border-border/60 bg-card p-5">
        <h2 className="text-lg font-semibold">Create an organization</h2>
        <p className="text-sm text-muted-foreground">
          A new tenant of the dialer — companies and members live inside it.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Organization name (e.g. Tesla Energy)" />
          <input className={field} value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Industry (optional)" />
          <Button
            variant="danger"
            className="shrink-0 gap-2"
            disabled={!name.trim() || busy === "createOrg"}
            onClick={() => {
              onCreateOrg(name, industry);
              setName("");
              setIndustry("");
            }}
          >
            {busy === "createOrg" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Create
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="space-y-3">
        {orgs.map((o) => {
          const orgCompanies = companies.filter((c) => c.orgId === o.id);
          const members = accounts.filter((a) => a.orgId === o.id);
          const open = expanded === o.id;
          return (
            <div key={o.id} className="overflow-hidden rounded-2xl border border-border/60 bg-card">
              <div className="flex flex-wrap items-center gap-3 p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger/10 text-danger">
                  <Building2 className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{o.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {o.industry || "—"} · {o.companyCount} companies · {o.memberCount} members
                  </p>
                </div>
                <Badge tone={o.status === "active" ? "success" : "warning"} className="capitalize">
                  {o.status}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onSetStatus(o.id, o.status === "active" ? "suspended" : "active")}
                  disabled={busy === o.id}
                >
                  {o.status === "active" ? "Suspend" : "Activate"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setExpanded(open ? null : o.id)}>
                  {open ? "Hide" : "Manage"}
                </Button>
                <button
                  type="button"
                  aria-label="Delete organization"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                  onClick={() => {
                    if (confirm(`Delete ${o.name}? Companies are removed and members are unassigned.`))
                      onDeleteOrg(o.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {open && (
                <div className="grid grid-cols-1 gap-4 border-t border-border/60 bg-muted/30 p-4 lg:grid-cols-2">
                  {/* Companies */}
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Companies
                    </p>
                    <div className="space-y-1.5">
                      {orgCompanies.length === 0 && (
                        <p className="text-sm text-muted-foreground">No companies yet.</p>
                      )}
                      {orgCompanies.map((c) => (
                        <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="flex-1 truncate text-sm">{c.name}</span>
                          <button
                            type="button"
                            aria-label="Delete company"
                            className="text-muted-foreground hover:text-danger"
                            onClick={() => onDeleteCompany(c.id)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <input
                        className={field}
                        value={expanded === o.id ? companyName : ""}
                        onChange={(e) => setCompanyName(e.target.value)}
                        placeholder="New company name"
                      />
                      <Button
                        size="sm"
                        variant="danger"
                        className="shrink-0 gap-1.5"
                        disabled={!companyName.trim() || busy === `c-${o.id}`}
                        onClick={() => {
                          onAddCompany(o.id, companyName);
                          setCompanyName("");
                        }}
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Add
                      </Button>
                    </div>
                  </div>

                  {/* Members */}
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      Members ({members.length})
                    </p>
                    <div className="space-y-1.5">
                      {members.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No members. Assign accounts in the Accounts tab.
                        </p>
                      )}
                      {members.map((m) => (
                        <div key={m.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
                          <Avatar initials={initials(m.name)} color="#ef4444" size="xs" />
                          <span className="min-w-0 flex-1 truncate text-sm">{m.name}</span>
                          {m.companyId && (
                            <Badge tone="outline">
                              {companies.find((c) => c.id === m.companyId)?.name ?? "Company"}
                            </Badge>
                          )}
                          {m.disabled && <Badge tone="warning">Suspended</Badge>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Accounts ───────────────────────────────────────────────────────────────────
function AccountsTab({
  accounts,
  orgs,
  companies,
  busy,
  onAssign,
  onToggle,
  onDelete,
}: {
  accounts: Account[];
  orgs: Org[];
  companies: Company[];
  busy: string | null;
  onAssign: (id: string, orgId: string | null, companyId: string | null) => void;
  onToggle: (id: string, disabled: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const sel =
    "h-9 rounded-lg border border-border bg-background px-2 text-xs outline-none focus-visible:border-danger/50";
  return (
    <div className="overflow-hidden rounded-2xl border border-border/60 bg-card">
      <div className="border-b border-border p-5">
        <h2 className="text-lg font-semibold">Accounts</h2>
        <p className="text-sm text-muted-foreground">
          {accounts.length} account{accounts.length === 1 ? "" : "s"} — assign to an
          organization & company, suspend, or delete.
        </p>
      </div>
      {accounts.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          No accounts found. (Requires the Supabase service role.)
        </p>
      ) : (
        <div className="divide-y divide-border">
          {accounts.map((a) => {
            const orgCompanies = companies.filter((c) => c.orgId === a.orgId);
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-3 p-4">
                <Avatar initials={initials(a.name)} color={a.disabled ? "#9ca3af" : "#ef4444"} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", a.disabled && "text-muted-foreground line-through")}>
                    {a.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.email}
                    {a.lastSignInAt ? ` · seen ${relativeTime(a.lastSignInAt)}` : ""}
                  </p>
                </div>

                <select
                  className={sel}
                  value={a.orgId ?? ""}
                  disabled={busy === `as-${a.id}`}
                  onChange={(e) => onAssign(a.id, e.target.value || null, null)}
                >
                  <option value="">Unassigned</option>
                  {orgs.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>

                <select
                  className={sel}
                  value={a.companyId ?? ""}
                  disabled={!a.orgId || busy === `as-${a.id}`}
                  onChange={(e) => onAssign(a.id, a.orgId, e.target.value || null)}
                >
                  <option value="">No company</option>
                  {orgCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>

                <Badge tone={a.disabled ? "warning" : "success"}>
                  {a.disabled ? "Suspended" : "Active"}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy === a.id}
                  onClick={() => onToggle(a.id, a.disabled)}
                >
                  {a.disabled ? <UserCheck className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                  {a.disabled ? "Restore" : "Suspend"}
                </Button>
                <button
                  type="button"
                  aria-label="Delete account"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                  disabled={busy === `del-${a.id}`}
                  onClick={() => {
                    if (confirm(`Permanently delete ${a.email} and all their data?`))
                      onDelete(a.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── App Control ──────────────────────────────────────────────────────────────
function AppControlTab({
  settings,
  busy,
  onMaintenance,
}: {
  settings: Settings;
  busy: string | null;
  onMaintenance: (on: boolean, message: string) => void;
}) {
  const [message, setMessage] = useState(settings.message);
  useEffect(() => setMessage(settings.message), [settings.message]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-danger/30 bg-danger/5 p-5">
        <div className="flex items-center gap-2">
          <Power className="h-4 w-4 text-danger" />
          <h2 className="text-lg font-semibold">App status & access</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Shut the whole product off for everyone (you stay in). Show an optional
          message on the lockout screen.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Lockout message</span>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="We'll be back shortly."
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-danger/50 focus-visible:ring-2 focus-visible:ring-danger/15"
            />
          </label>
          {settings.maintenance ? (
            <Button variant="success" className="gap-2" disabled={busy === "maint"} onClick={() => onMaintenance(false, message)}>
              {busy === "maint" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Resume app
            </Button>
          ) : (
            <Button variant="danger" className="gap-2" disabled={busy === "maint"} onClick={() => onMaintenance(true, message)}>
              {busy === "maint" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              Shut down app
            </Button>
          )}
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold",
              settings.maintenance ? "bg-danger/10 text-danger" : "bg-success/10 text-success",
            )}
          >
            {settings.maintenance ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            {settings.maintenance ? "App is OFFLINE for all non-superadmins" : "App is live"}
          </span>
        </div>
      </div>
    </div>
  );
}
