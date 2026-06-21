"use client";

import {
  AlertTriangle,
  Ban,
  Loader2,
  LogOut,
  Power,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn, initials } from "@/lib/utils";

type Account = {
  id: string;
  email: string;
  name: string;
  role: string;
  disabled: boolean;
  createdAt: string;
  lastSignInAt: string | null;
};
type Settings = { maintenance: boolean; message: string };

export function AppManagement() {
  const [settings, setSettings] = useState<Settings>({ maintenance: false, message: "" });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    fetch("/api/superadmin/control")
      .then((r) => r.json())
      .then((j) => {
        if (j.settings) {
          setSettings(j.settings);
          setMessage(j.settings.message ?? "");
        }
        setAccounts(j.accounts ?? []);
      })
      .catch(() => setErr("Could not load app state."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  async function control(body: Record<string, unknown>, key: string) {
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
  }

  async function signOut() {
    await fetch("/api/superadmin/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  }

  const suspended = accounts.filter((a) => a.disabled).length;

  return (
    <div className="space-y-5">
      {/* Banner */}
      <Card className="flex flex-col items-start gap-3 border-danger/40 bg-danger/5 p-5 sm:flex-row sm:items-center">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-danger text-danger-foreground shadow-glow">
          <ShieldAlert className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <p className="flex items-center gap-2 text-base font-bold">
            Superadmin · App Management
            <Badge tone="danger">Overseer</Badge>
          </p>
          <p className="text-sm text-muted-foreground">
            Full control over every account and the app itself — above admins and
            managers. Actions here are immediate and global.
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-2" onClick={signOut}>
          <LogOut className="h-4 w-4" />
          Exit superadmin
        </Button>
      </Card>

      {err && (
        <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">{err}</p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat icon={Users} label="Accounts" value={accounts.length} />
        <Stat icon={UserCheck} label="Active" value={accounts.length - suspended} tone="success" />
        <Stat icon={Ban} label="Suspended" value={suspended} tone="warning" />
        <Stat
          icon={Power}
          label="App status"
          value={settings.maintenance ? "Down" : "Live"}
          tone={settings.maintenance ? "danger" : "success"}
        />
      </div>

      {/* App power */}
      <Card className="p-5">
        <div className="flex items-center gap-2">
          <Power className="h-4 w-4 text-danger" />
          <h3 className="text-lg font-semibold tracking-tight">App status & access</h3>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Shut the whole app off for everyone (you stay in). Optionally show a
          message on the lockout screen.
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1 space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Lockout message</span>
            <input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="We'll be back shortly."
              className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15"
            />
          </label>
          {settings.maintenance ? (
            <Button
              variant="success"
              className="gap-2"
              disabled={busy === "maint"}
              onClick={() => control({ action: "maintenance", on: false, message }, "maint")}
            >
              {busy === "maint" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              Resume app
            </Button>
          ) : (
            <Button
              variant="danger"
              className="gap-2"
              disabled={busy === "maint"}
              onClick={() => control({ action: "maintenance", on: true, message }, "maint")}
            >
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
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {settings.maintenance ? "App is shut down for all non-superadmins" : "App is live"}
          </span>
        </div>
      </Card>

      {/* Accounts */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Accounts</h3>
            <p className="text-sm text-muted-foreground">
              Every account — suspend access or delete entirely.
            </p>
          </div>
          <Badge tone="neutral">{accounts.length}</Badge>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading accounts…
          </div>
        ) : accounts.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-muted-foreground">
            No accounts found. (Requires the Supabase service role.)
          </div>
        ) : (
          <div className="divide-y divide-border">
            {accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 p-4">
                <Avatar initials={initials(a.name)} color={a.disabled ? "#9ca3af" : "#0EA5E9"} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className={cn("truncate text-sm font-semibold", a.disabled && "text-muted-foreground line-through")}>
                    {a.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{a.email}</p>
                </div>
                <Badge tone="outline" className="capitalize">
                  {a.role}
                </Badge>
                <Badge tone={a.disabled ? "warning" : "success"}>
                  {a.disabled ? "Suspended" : "Active"}
                </Badge>
                {a.disabled ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busy === a.id}
                    onClick={() => control({ action: "enable", id: a.id }, a.id)}
                  >
                    <UserCheck className="h-3.5 w-3.5" />
                    Restore
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busy === a.id}
                    onClick={() => control({ action: "disable", id: a.id }, a.id)}
                  >
                    <Ban className="h-3.5 w-3.5" />
                    Suspend
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  className="gap-1.5"
                  disabled={busy === a.id + "del"}
                  onClick={() => {
                    if (
                      confirm(
                        `Permanently delete ${a.email} and all their data? This cannot be undone.`,
                      )
                    )
                      control({ action: "delete", id: a.id }, a.id + "del");
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const tones = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-success/12 text-success",
    warning: "bg-warning/15 text-warning",
    danger: "bg-danger/12 text-danger",
  } as const;
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", tones[tone])}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none tabular">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </Card>
  );
}
