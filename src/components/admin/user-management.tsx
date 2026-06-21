"use client";

import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Loader2,
  Mail,
  Shield,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Portal } from "@/components/ui/portal";
import { cn, initials } from "@/lib/utils";

type Role = "admin" | "manager" | "rep";
type Access = "full" | "standard" | "limited";

type Member = {
  id: string;
  email: string;
  name: string;
  role: Role;
  accessLevel: Access;
  permissions: Record<string, boolean>;
  status: "invited" | "active" | "disabled";
  createdAt: string;
};

const PERMS: { key: string; label: string }[] = [
  { key: "dial", label: "Place & manage calls" },
  { key: "leads", label: "Manage leads" },
  { key: "reports", label: "View reports & analytics" },
  { key: "appointments", label: "Manage appointments & callbacks" },
  { key: "team", label: "Manage users & access" },
  { key: "settings", label: "Configure integrations" },
];

const ROLE_DEFAULTS: Record<Role, { access: Access; perms: Record<string, boolean> }> = {
  admin: {
    access: "full",
    perms: { dial: true, leads: true, reports: true, appointments: true, team: true, settings: true },
  },
  manager: {
    access: "standard",
    perms: { dial: true, leads: true, reports: true, appointments: true, team: false, settings: false },
  },
  rep: {
    access: "limited",
    perms: { dial: true, leads: true, reports: false, appointments: true, team: false, settings: false },
  },
};

const roleTone: Record<Role, "primary" | "accent" | "neutral"> = {
  admin: "primary",
  manager: "accent",
  rep: "neutral",
};
const statusTone: Record<Member["status"], "success" | "warning" | "neutral"> = {
  active: "success",
  invited: "warning",
  disabled: "neutral",
};

export function UserManagement({
  owner,
  adminConfigured,
}: {
  owner: { name: string; email: string } | null;
  adminConfigured: boolean;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/team/members")
      .then((r) => r.json())
      .then((j) => setMembers(j.members ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  async function remove(id: string) {
    await fetch(`/api/team/members?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(
      () => {},
    );
    load();
  }

  async function changeRole(m: Member, role: Role) {
    await fetch("/api/team/members", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: m.id,
        role,
        accessLevel: ROLE_DEFAULTS[role].access,
        permissions: ROLE_DEFAULTS[role].perms,
      }),
    }).catch(() => {});
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">Users & access</h3>
          <p className="text-sm text-muted-foreground">
            {members.length + 1} member{members.length === 0 ? "" : "s"} · role &
            permission based access
          </p>
        </div>
        <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
          <UserPlus className="h-4 w-4" />
          Add user
        </Button>
      </div>

      <div className="space-y-2">
        {/* Owner (you) */}
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft/40 p-3">
          <Avatar initials={initials(owner?.name ?? "You")} color="#3B82F6" size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{owner?.name ?? "You"}</p>
            <p className="truncate text-xs text-muted-foreground">{owner?.email}</p>
          </div>
          <Badge tone="primary" className="gap-1">
            <Crown className="h-3 w-3" />
            Owner
          </Badge>
          <Badge tone="success">Full access</Badge>
        </div>

        {/* Members */}
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading team…
          </div>
        ) : members.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
            No teammates yet. Add a user to grant scoped access.
          </div>
        ) : (
          members.map((m) => {
            const permCount = PERMS.filter((p) => m.permissions[p.key]).length;
            return (
              <div
                key={m.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-3"
              >
                <Avatar
                  initials={initials(m.name || m.email)}
                  color="#0EA5E9"
                  size="sm"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{m.name || m.email}</p>
                  <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                </div>
                <Badge tone={statusTone[m.status]} className="capitalize">
                  {m.status}
                </Badge>
                <Badge tone="outline" className="capitalize">
                  {m.accessLevel} access
                </Badge>
                <span
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground"
                  title={PERMS.filter((p) => m.permissions[p.key])
                    .map((p) => p.label)
                    .join(", ")}
                >
                  <Shield className="h-3.5 w-3.5" />
                  {permCount}/{PERMS.length}
                </span>
                <select
                  value={m.role}
                  onChange={(e) => changeRole(m, e.target.value as Role)}
                  className="h-8 rounded-lg border border-border bg-background px-2 text-xs font-semibold capitalize outline-none focus-visible:border-primary/50"
                >
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="rep">Rep</option>
                </select>
                <button
                  type="button"
                  onClick={() => remove(m.id)}
                  aria-label="Remove user"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {open && (
        <AddUserDialog
          adminConfigured={adminConfigured}
          onClose={() => setOpen(false)}
          onAdded={() => {
            setOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddUserDialog({
  adminConfigured,
  onClose,
  onAdded,
}: {
  adminConfigured: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("rep");
  const [access, setAccess] = useState<Access>(ROLE_DEFAULTS.rep.access);
  const [perms, setPerms] = useState<Record<string, boolean>>(ROLE_DEFAULTS.rep.perms);
  const [sendInvite, setSendInvite] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function applyRole(r: Role) {
    setRole(r);
    setAccess(ROLE_DEFAULTS[r].access);
    setPerms({ ...ROLE_DEFAULTS[r].perms });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.includes("@")) {
      setMsg({ ok: false, text: "Enter a valid email." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/team/members", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          role,
          accessLevel: access,
          permissions: perms,
          sendInvite,
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) {
        setMsg({ ok: false, text: j.error ?? "Could not add user." });
        return;
      }
      onAdded();
    } catch {
      setMsg({ ok: false, text: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  const field =
    "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm capitalize outline-none focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15";

  return (
    <Portal>
    <motion.div
      className="fixed inset-0 z-[100] flex items-end justify-center sm:items-center sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="absolute inset-0 bg-background/70 backdrop-blur-xl"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      />
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        className="glass relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border/60 shadow-lift sm:max-h-[88vh] sm:rounded-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/60 p-5">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <UserPlus className="h-5 w-5" />
            </span>
            <div>
              <p className="text-base font-semibold leading-tight">Add a user</p>
              <p className="text-xs text-muted-foreground">
                Grant a role, access level & specific permissions.
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

        <form onSubmit={submit} className="flex-1 space-y-4 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Rep" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@company.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <select
                value={role}
                onChange={(e) => applyRole(e.target.value as Role)}
                className={field}
              >
                <option value="admin">Admin — full control</option>
                <option value="manager">Manager — floor oversight</option>
                <option value="rep">Rep — dialing</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Access level</Label>
              <select
                value={access}
                onChange={(e) => setAccess(e.target.value as Access)}
                className={field}
              >
                <option value="full">Full</option>
                <option value="standard">Standard</option>
                <option value="limited">Limited</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Permissions</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {PERMS.map((p) => {
                const on = Boolean(perms[p.key]);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setPerms((prev) => ({ ...prev, [p.key]: !on }))}
                    className={cn(
                      "flex items-center gap-2.5 rounded-xl border p-3 text-left text-sm transition-colors",
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
                      {on && <CheckCircle2 className="h-3 w-3" />}
                    </span>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <label className="flex cursor-pointer items-center justify-between rounded-xl border border-border/70 bg-surface/50 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-medium">
              <Mail className="h-4 w-4 text-muted-foreground" />
              Send email invite
              {!adminConfigured && (
                <span className="text-xs text-muted-foreground">(needs service role)</span>
              )}
            </span>
            <input
              type="checkbox"
              checked={sendInvite}
              onChange={(e) => setSendInvite(e.target.checked)}
              className="peer sr-only"
            />
            <span className="relative h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary">
              <span
                className={cn(
                  "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                  sendInvite && "translate-x-5",
                )}
              />
            </span>
          </label>

          {msg && (
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs",
                msg.ok ? "text-success" : "text-danger",
              )}
            >
              {msg.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              )}
              {msg.text}
            </p>
          )}
        </form>

        <div className="flex gap-2 border-t border-border/60 p-5">
          <Button variant="ghost" className="flex-1" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button className="flex-1 gap-2" onClick={submit} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            Add user
          </Button>
        </div>
      </motion.div>
    </motion.div>
    </Portal>
  );
}
