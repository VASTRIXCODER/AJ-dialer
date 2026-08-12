"use client";

import {
  Bell,
  Building2,
  CalendarCheck,
  Check,
  Minus,
  Monitor,
  Moon,
  PhoneCall,
  Radio,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import {
  PERMISSION_LABEL,
  PERMISSIONS,
  type OrgRole,
  ROLE_DESCRIPTION,
  ROLE_LABEL,
} from "@/lib/permissions";
import { cn } from "@/lib/utils";

function Switch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

function PrefRow({
  icon: Icon,
  title,
  desc,
  checked,
  onChange,
}: {
  icon: typeof Bell;
  title: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3.5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onChange={onChange} />
    </div>
  );
}

export function SettingsView({
  account,
  role = null,
  orgName = null,
  productName = null,
  membershipStatus = "none",
  permissions = [],
}: {
  account?: { name: string; email: string } | null;
  role?: OrgRole | null;
  orgName?: string | null;
  productName?: string | null;
  membershipStatus?: "active" | "pending" | "none";
  permissions?: string[];
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const displayName = account?.name ?? "Your account";
  const displayEmail = account?.email ?? "";
  const displayInitials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "·";

  const [name, setName] = useState(displayName);
  const [team, setTeam] = useState("AIATWORK");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function saveProfile() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: name, team }),
      });
      if (res.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const [prefs, setPrefs] = useState({
    autoDial: true,
    recording: true,
    parallelDefault: true,
    desktopNotif: true,
    emailDigest: false,
    callbackAlerts: true,
  });
  const set = (k: keyof typeof prefs) => (v: boolean) =>
    setPrefs((p) => ({ ...p, [k]: v }));

  const themes = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
    { key: "system", label: "System", icon: Monitor },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {/* Profile */}
      <Card className="p-6 lg:col-span-1">
        <div className="flex flex-col items-center text-center">
          <Avatar
            initials={displayInitials}
            tone="primary"
            size="lg"
            className="h-20 w-20 text-2xl"
          />
          <h3 className="mt-3 text-lg font-bold">{displayName}</h3>
          {displayEmail && (
            <p className="text-sm text-muted-foreground">{displayEmail}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
            {role && (
              <Badge tone={role === "rep" ? "neutral" : "primary"}>
                {ROLE_LABEL[role]}
              </Badge>
            )}
            {membershipStatus === "pending" && <Badge tone="warning">Pending approval</Badge>}
          </div>
          {orgName && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" />
              {orgName}
              {productName ? ` · ${productName}` : ""}
            </p>
          )}
        </div>
      </Card>

      <div className="space-y-4 lg:col-span-2">
        {/* Account */}
        <Card className="p-6">
          <h3 className="font-semibold">Account</h3>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Full name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Email</Label>
              <Input value={displayEmail} readOnly disabled />
            </div>
            <div>
              <Label>Team</Label>
              <Input value={team} onChange={(e) => setTeam(e.target.value)} />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {saved && <span className="text-xs font-medium text-success">Saved ✓</span>}
            <Button size="sm" onClick={saveProfile} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-xs text-muted-foreground">
            <Link href="/terms" target="_blank" className="font-medium hover:text-foreground hover:underline">
              Terms of Service
            </Link>
            <Link href="/privacy" target="_blank" className="font-medium hover:text-foreground hover:underline">
              Privacy Policy
            </Link>
            <Link href="/acceptable-use" target="_blank" className="font-medium hover:text-foreground hover:underline">
              Acceptable Use Policy
            </Link>
          </div>
        </Card>

        {/* Access & permissions */}
        <Card className="p-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Access &amp; permissions</h3>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {role
              ? `You're ${ROLE_LABEL[role]} in this organization. ${ROLE_DESCRIPTION[role]}`
              : "You're not an active member of an organization yet."}
          </p>
          <div className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {PERMISSIONS.map((p) => {
              const granted = permissions.includes(p);
              return (
                <div
                  key={p}
                  className={cn(
                    "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm",
                    granted ? "text-foreground" : "text-muted-foreground/60",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
                      granted ? "bg-success/15 text-success" : "bg-muted text-muted-foreground/60",
                    )}
                  >
                    {granted ? <Check className="h-3.5 w-3.5" /> : <Minus className="h-3 w-3" />}
                  </span>
                  {PERMISSION_LABEL[p]}
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Permissions are set by your organization’s admins. Ask an admin if you need more access.
          </p>
        </Card>

        {/* Appearance */}
        <Card className="p-6">
          <h3 className="font-semibold">Appearance</h3>
          <p className="text-sm text-muted-foreground">Choose your interface theme</p>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {themes.map((t) => {
              const active = mounted && theme === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTheme(t.key)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-xl border p-4 transition-all active:scale-95",
                    active
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-border bg-surface text-muted-foreground hover:bg-muted",
                  )}
                >
                  <t.icon className="h-5 w-5" />
                  <span className="text-sm font-semibold">{t.label}</span>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Dialer preferences */}
        <Card className="p-6">
          <h3 className="font-semibold">Dialer preferences</h3>
          <div className="mt-2 divide-y divide-border">
            <PrefRow
              icon={Radio}
              title="Auto-dial next lead"
              desc="Automatically start the next call after disposition"
              checked={prefs.autoDial}
              onChange={set("autoDial")}
            />
            <PrefRow
              icon={PhoneCall}
              title="Default to 3X parallel"
              desc="Start sessions with three simultaneous lines"
              checked={prefs.parallelDefault}
              onChange={set("parallelDefault")}
            />
            <PrefRow
              icon={Radio}
              title="Record calls"
              desc="Capture dual-channel recordings for QA"
              checked={prefs.recording}
              onChange={set("recording")}
            />
          </div>
        </Card>

        {/* Notifications */}
        <Card className="p-6">
          <h3 className="font-semibold">Notifications</h3>
          <div className="mt-2 divide-y divide-border">
            <PrefRow
              icon={Bell}
              title="Desktop notifications"
              desc="Callback reminders and live alerts"
              checked={prefs.desktopNotif}
              onChange={set("desktopNotif")}
            />
            <PrefRow
              icon={CalendarCheck}
              title="Callback alerts"
              desc="Notify me when a callback is due"
              checked={prefs.callbackAlerts}
              onChange={set("callbackAlerts")}
            />
            <PrefRow
              icon={Bell}
              title="Daily email digest"
              desc="Performance summary every morning"
              checked={prefs.emailDigest}
              onChange={set("emailDigest")}
            />
          </div>
        </Card>
      </div>
    </div>
  );
}
