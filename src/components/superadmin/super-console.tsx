"use client";

import {
  AlertTriangle,
  Ban,
  Building2,
  CheckCircle2,
  LayoutDashboard,
  Loader2,
  LogOut,
  Power,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MetricCard } from "@/components/dashboard/metric-card";
import { SectionCard } from "@/components/shared/section-card";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Card } from "@/components/ui/card";
import { templateLabel } from "@/lib/org/templates";
import { cn, initials, relativeTime } from "@/lib/utils";
import { type Org, OrganizationsTab } from "./super-orgs";
import { SelectMenu } from "@/components/ui/select-menu";
import { CardSkeleton, MetricRowSkeleton, TableSkeleton } from "@/components/shared/skeletons";

/**
 * -- LOCKSTEP: keep in sync with ACCOUNT_PAGE in src/lib/db/app-control.ts --
 *
 * The page size `listAccounts` reads. Declared here rather than imported
 * because app-control.ts is `server-only`, and this is a client component —
 * importing a VALUE across that boundary type-checks fine and breaks the
 * production bundle. tests/superadmin-account-cap.test.ts asserts the two
 * numbers agree.
 */
const ACCOUNT_PAGE = 200;

type Settings = { maintenance: boolean; message: string };
type Account = {
  id: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
  platformAdmin: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  orgId: string | null;
  companyId: string | null;
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

  function signOut() {
    // Superadmin is your normal identity now — just return to the app.
    window.location.href = "/hub";
  }

  const suspended = accounts.filter((a) => a.disabled).length;
  const pending = orgs.reduce((n, o) => n + o.pendingCount, 0);

  return (
    <div className="superadmin-theme relative min-h-screen bg-background text-foreground">
      {/* The console is an Instrument, not a Stage: it is org tables, KPI tiles
          and destructive controls. The ambient field is not mounted here for
          the same reason it is not mounted in the app shell. */}

      {/* Header */}
      <header className="relative border-b border-border/60 surface-glass">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand text-white">
            <ShieldAlert className="h-6 w-6" />
          </span>
          <div className="flex-1">
            <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight">
              Superadmin Console
              <Badge tone="danger">Overseer</Badge>
            </h1>
            <p className="text-xs text-muted-foreground">
              Govern every organization, company &amp; account across the platform.
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
        <div className="mx-auto max-w-7xl px-2 sm:px-5">
          <div className="flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors",
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
        </div>
      </header>

      <main className="relative mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
        {err && (
          <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{err}</p>
        )}
        {loading ? (
          /* The whole page used to collapse to a centred dot for the length of
             the first fetch, then snap back to a full console — the layout
             jumped every time anyone opened /console. A spinner is for an
             action in place; a page shows the shape of what is coming. */
          <>
            <MetricRowSkeleton count={4} />
            <CardSkeleton>
              <TableSkeleton rows={6} />
            </CardSkeleton>
          </>
        ) : tab === "overview" ? (
          <Overview
            orgs={orgs}
            companies={companies}
            accounts={accounts}
            suspended={suspended}
            pending={pending}
            settings={settings}
            busy={busy}
            onMaintenance={(on) => control({ action: "maintenance", on, message: settings.message }, "maint")}
            onManage={() => setTab("organizations")}
          />
        ) : tab === "organizations" ? (
          <OrganizationsTab orgs={orgs} onChanged={load} />
        ) : tab === "accounts" ? (
          <AccountsTab
            accounts={accounts}
            orgs={orgs}
            companies={companies}
            busy={busy}
            onAssign={(id, orgId, companyId) => control({ action: "assign", id, orgId, companyId }, `as-${id}`)}
            onToggle={(id, disabled) => control({ action: disabled ? "enable" : "disable", id }, id)}
            onDelete={(id) => control({ action: "delete", id }, `del-${id}`)}
            onPlatform={(id, on) => control({ action: "platform", id, on }, `pa-${id}`)}
          />
        ) : (
          <AppControlTab
            settings={settings}
            busy={busy}
            onMaintenance={(on, message) => control({ action: "maintenance", on, message }, "maint")}
          />
        )}
      </main>
    </div>
  );
}

function Overview({
  orgs,
  companies,
  accounts,
  suspended,
  pending,
  settings,
  busy,
  onMaintenance,
  onManage,
}: {
  orgs: Org[];
  companies: Company[];
  accounts: Account[];
  suspended: number;
  pending: number;
  settings: Settings;
  busy: string | null;
  onMaintenance: (on: boolean) => void;
  onManage: () => void;
}) {
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Organizations"
          value={String(orgs.length)}
          window="current"
          scope="platform"
          icon={Building2}
          accent="primary"
        />
        <MetricCard
          label="Companies"
          value={String(companies.length)}
          window="current"
          scope="platform"
          icon={Building2}
          accent="accent"
        />
        <MetricCard
          label="Accounts"
          // listAccounts reads ONE page of auth users (perPage: 200,
          // src/lib/db/app-control.ts). Past 200 accounts this tile reads "200"
          // forever — a page size rendered as a platform total. The number is
          // still a page size; it no longer claims not to be. Paging the real
          // total is a change to app-control.ts, not to a caption.
          value={`${accounts.length >= ACCOUNT_PAGE ? "≥" : ""}${accounts.length}`}
          windowDetail={accounts.length >= ACCOUNT_PAGE ? "first page only" : undefined}
          window="current"
          scope="platform"
          icon={Users}
          accent="success"
        />
        <MetricCard
          label="Pending"
          value={String(pending)}
          window="current"
          scope="platform"
          icon={UserCheck}
          accent="warning"
        />
        <MetricCard
          label="Suspended"
          value={String(suspended)}
          // Inherits the same one-page cap as Accounts: account 201 can be
          // suspended and never appear here.
          windowDetail={accounts.length >= ACCOUNT_PAGE ? "first page only" : undefined}
          window="current"
          scope="platform"
          icon={Ban}
          accent="danger"
        />
        <MetricCard
          label="App status"
          // Not a metric — a word in a 40px numeric slot, next to five counts.
          // It should be a Badge; converting it means restructuring this row,
          // which is a visual change I cannot verify from here. It at least
          // stops pretending it covers a window.
          sub="global kill switch"
          value={settings.maintenance ? "Offline" : "Live"}
          icon={Power}
          accent={settings.maintenance ? "danger" : "success"}
        />
      </div>

      <Card className="border-danger/30 p-5">
        <div className="flex items-center gap-2">
          <Power className="h-4 w-4 text-danger" />
          <h2 className="text-lg font-semibold">Global kill switch</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Take the whole product offline for every account (you keep access).
        </p>
        <div className="mt-3">
          {settings.maintenance ? (
            <Button variant="success" className="gap-2" disabled={busy === "maint"} onClick={() => onMaintenance(false)}>
              {busy === "maint" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Resume app
            </Button>
          ) : (
            <Button variant="danger" className="gap-2" disabled={busy === "maint"} onClick={() => onMaintenance(true)}>
              {busy === "maint" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
              Shut down app
            </Button>
          )}
        </div>
      </Card>

      <SectionCard title="Organizations" description="Each is a specialization of the dialer.">
        <div className="space-y-2">
          {orgs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No organizations yet. Provision one from the Organizations tab.
            </p>
          ) : (
            orgs.slice(0, 6).map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-xl border border-border p-3">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-white"
                  style={{
                    background: o.brandColor
                      ? `linear-gradient(135deg, ${o.brandColor}, ${o.brandColor}cc)`
                      : "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--accent)))",
                  }}
                >
                  <Building2 className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{o.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{templateLabel(o.dialerTemplate)}</p>
                </div>
                <span className="text-xs text-muted-foreground">{o.memberCount} members</span>
                {o.pendingCount > 0 && <Badge tone="warning">{o.pendingCount} pending</Badge>}
                <Badge tone={o.status === "active" ? "success" : "warning"} className="capitalize">
                  {o.status}
                </Badge>
              </div>
            ))
          )}
        </div>
        <Button variant="outline" size="sm" className="mt-3 gap-2" onClick={onManage}>
          <Building2 className="h-4 w-4" />
          Manage organizations
        </Button>
      </SectionCard>
    </div>
  );
}

function AccountsTab({
  accounts,
  orgs,
  companies,
  busy,
  onAssign,
  onToggle,
  onDelete,
  onPlatform,
}: {
  accounts: Account[];
  orgs: Org[];
  companies: Company[];
  busy: string | null;
  onAssign: (id: string, orgId: string | null, companyId: string | null) => void;
  onToggle: (id: string, disabled: boolean) => void;
  onDelete: (id: string) => void;
  onPlatform: (id: string, on: boolean) => void;
}) {
  const confirmDialog = useConfirm();
  const sel = "h-9 rounded-lg border border-border bg-background px-2 text-xs outline-none";
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-5">
        <h2 className="text-lg font-semibold">Accounts</h2>
        <p className="text-sm text-muted-foreground">
          {accounts.length} account{accounts.length === 1 ? "" : "s"} — assign to an
          organization &amp; company, suspend, or delete.
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
                <Avatar initials={initials(a.name)} tone={a.disabled ? "muted" : "danger"} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", a.disabled && "text-muted-foreground line-through")}>
                    {a.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.email}
                    {a.lastSignInAt ? ` · seen ${relativeTime(a.lastSignInAt)}` : ""}
                  </p>
                </div>
                <SelectMenu
                  label="Organization"
                  size="sm"
                  triggerClassName="h-8"
                  value={a.orgId ?? "none"}
                  disabled={busy === `as-${a.id}`}
                  disabledReason="Saving…"
                  onChange={(v) => onAssign(a.id, v === "none" ? null : v, null)}
                  options={[
                    { value: "none", label: "Unassigned" },
                    ...orgs.map((o) => ({ value: o.id, label: o.name })),
                  ]}
                />
                <SelectMenu
                  label="Company"
                  size="sm"
                  triggerClassName="h-8"
                  value={a.companyId ?? "none"}
                  disabled={!a.orgId || busy === `as-${a.id}`}
                  disabledReason={
                    a.orgId ? "Saving…" : "Assign an organization first."
                  }
                  onChange={(v) => onAssign(a.id, a.orgId, v === "none" ? null : v)}
                  options={[
                    { value: "none", label: "No company" },
                    ...orgCompanies.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
                <Badge tone={a.disabled ? "warning" : "success"}>
                  {a.disabled ? "Suspended" : "Active"}
                </Badge>
                {a.platformAdmin && <Badge tone="primary">Platform</Badge>}
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={busy === `pa-${a.id}`}
                  onClick={() => onPlatform(a.id, !a.platformAdmin)}
                  title="Grant or revoke hidden platform-superadmin access"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {a.platformAdmin ? "Revoke platform" : "Make platform"}
                </Button>
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
                  disabled={busy === `del-${a.id}`}
                  onClick={async () => {
                    if (
                      await confirmDialog({
                        title: `Permanently delete ${a.email}?`,
                        body: "The account and its access are removed for good.",
                        tone: "danger",
                        confirmLabel: "Delete account",
                      })
                    )
                      onDelete(a.id);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

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
    <Card className="border-danger/30 p-5">
      <div className="flex items-center gap-2">
        <Power className="h-4 w-4 text-danger" />
        <h2 className="text-lg font-semibold">App status &amp; access</h2>
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
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-danger/50"
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
    </Card>
  );
}
