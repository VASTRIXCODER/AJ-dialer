"use client";

import {
  Bell,
  CalendarCheck,
  Monitor,
  Moon,
  PhoneCall,
  Radio,
  Sun,
  TrendingUp,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { currentRep } from "@/lib/data";
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
}: {
  account?: { name: string; email: string } | null;
}) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const displayName = account?.name ?? currentRep.name;
  const displayEmail = account?.email ?? currentRep.email;
  const displayInitials =
    displayName
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || currentRep.initials;

  const [name, setName] = useState(displayName);
  const [team, setTeam] = useState(currentRep.team);
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

  const stats = [
    { label: "Calls today", value: currentRep.callsToday, icon: PhoneCall },
    { label: "Conversations", value: currentRep.conversationsToday, icon: Radio },
    { label: "Appointments", value: currentRep.appointmentsToday, icon: CalendarCheck },
    { label: "Score", value: currentRep.score, icon: TrendingUp },
  ];

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
            color={currentRep.avatarColor}
            size="lg"
            className="h-20 w-20 text-2xl"
          />
          <h3 className="mt-3 text-lg font-bold">{displayName}</h3>
          <p className="text-sm text-muted-foreground">{displayEmail}</p>
          <Badge tone="primary" className="mt-2 capitalize">
            {currentRep.role} · {currentRep.team}
          </Badge>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl bg-muted p-3 text-center">
              <s.icon className="mx-auto h-4 w-4 text-muted-foreground" />
              <p className="mt-1.5 text-xl font-bold tabular">{s.value}</p>
              <p className="text-[11px] text-muted-foreground">{s.label}</p>
            </div>
          ))}
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
            <div>
              <Label>Caller ID</Label>
              <Input defaultValue="" placeholder="+1 (555) 000-0000" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {saved && <span className="text-xs font-medium text-success">Saved ✓</span>}
            <Button size="sm" onClick={saveProfile} disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
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
