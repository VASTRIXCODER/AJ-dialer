"use client";

import { Loader2, Save } from "lucide-react";
import { useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { SelectMenu } from "@/components/ui/select-menu";
import { useToast } from "@/components/ui/toast";
import type { MessagingSettings } from "@/lib/org/settings";

// ─────────────────────────────────────────────────────────────────────────────
// The messaging switches an admin actually owns.
//
// Note what is NOT here: an auto-send toggle. The database refuses any message
// reaching a sendable status without a named approver, so a switch offering to
// bypass that would be a lie in the UI. It is not a setting someone can find.
//
// Note also what messaging hours are NOT: the org's calling hours. That window
// defaults to advisory (`enforced: false`), and flipping it on to serve
// messaging would immediately change live CALL behaviour for every workspace.
// Messaging quiet hours can never be advisory, so they get their own window.
// ─────────────────────────────────────────────────────────────────────────────

const HOURS = Array.from({ length: 24 }, (_, h) => ({
  value: String(h),
  label: fmtHour(h),
}));

function fmtHour(h: number): string {
  const hh = ((h % 24) + 24) % 24;
  return `${hh % 12 === 0 ? 12 : hh % 12}${hh < 12 ? "am" : "pm"}`;
}

export function MessagingSettingsPanel({
  initial,
  canEdit,
}: {
  initial: MessagingSettings;
  canEdit: boolean;
}) {
  const { toast } = useToast();
  const [value, setValue] = useState<MessagingSettings>(initial);
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof MessagingSettings>(k: K, v: MessagingSettings[K]) =>
    setValue((prev) => ({ ...prev, [k]: v }));

  const windowBroken = value.quietHours.startHour === value.quietHours.endHour;

  async function save() {
    if (windowBroken) {
      toast({
        title: "Those hours cancel out",
        description: "A window that starts and ends at the same hour would hold every message forever.",
        tone: "danger",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/org/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { messaging: value } }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast({ title: j.error ?? "Couldn't save.", tone: "danger" });
        return;
      }
      toast({
        title: "Messaging settings saved",
        description: value.enabled
          ? "Check the readiness panel below before relying on it."
          : "Messaging is off, so nothing will be proposed or sent.",
        tone: "success",
      });
    } catch {
      toast({ title: "Couldn't save.", tone: "danger" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="Messaging"
      description="Whether this workspace may message customers, when, and how often."
    >
      <label className="flex items-start gap-2.5">
        <input
          type="checkbox"
          checked={value.enabled}
          disabled={!canEdit}
          onChange={(e) => set("enabled", e.target.checked)}
          className="mt-1 h-[22px] w-[22px] rounded border-input"
        />
        <span>
          <span className="block text-sm font-medium">Allow messaging in this workspace</span>
          <span className="block text-xs text-muted-foreground">
            Off means no message is proposed or sent, whatever a playbook says. Turning it on
            does not send anything on its own — every message still waits for a person.
          </span>
        </span>
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label>Messages may go out from</Label>
          <div className="flex items-center gap-2">
            <SelectMenu
              label="Messaging window opens at"
              size="sm"
              value={String(value.quietHours.startHour)}
              onChange={(v) =>
                set("quietHours", { ...value.quietHours, startHour: Number(v) })
              }
              options={HOURS}
              disabled={!canEdit}
            />
            <span className="text-sm text-muted-foreground">until</span>
            <SelectMenu
              label="Messaging window closes at"
              size="sm"
              value={String(value.quietHours.endHour)}
              onChange={(v) => set("quietHours", { ...value.quietHours, endHour: Number(v) })}
              options={HOURS}
              disabled={!canEdit}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            In the RECIPIENT&apos;s timezone, not yours. When their stored timezone and their
            area code disagree, both have to be inside the window — so an unknown zone is
            treated as the stricter one.
          </p>
          {windowBroken && (
            <p className="mt-1 text-xs text-danger">
              These are the same hour, which would hold every message forever.
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="daily-cap">Most messages per day, whole workspace</Label>
          <Input
            id="daily-cap"
            type="number"
            min={0}
            value={value.dailyOrgCap}
            disabled={!canEdit}
            onChange={(e) => set("dailyOrgCap", Math.max(0, Number(e.target.value) || 0))}
          />
          <p className="mt-1 text-xs text-muted-foreground">
            0 means no limit, which leaves a misconfigured playbook with nothing stopping it.
          </p>
        </div>

        <div>
          <Label htmlFor="per-day">Most messages to one person per day</Label>
          <Input
            id="per-day"
            type="number"
            min={0}
            value={value.perContactPerDay}
            disabled={!canEdit}
            onChange={(e) => set("perContactPerDay", Math.max(0, Number(e.target.value) || 0))}
          />
        </div>

        <div>
          <Label htmlFor="per-week">Most messages to one person per 7 days</Label>
          <Input
            id="per-week"
            type="number"
            min={0}
            value={value.perContactPer7Days}
            disabled={!canEdit}
            onChange={(e) =>
              set("perContactPer7Days", Math.max(0, Number(e.target.value) || 0))
            }
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Counted against messages the carrier accepted, so a blocked one never uses up
            someone&apos;s allowance.
          </p>
        </div>
      </div>

      <div className="mt-4 flex justify-end">
        <Button size="sm" onClick={() => void save()} disabled={!canEdit || saving}>
          {saving ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-4 w-4" />
          )}
          Save
        </Button>
      </div>
    </SectionCard>
  );
}
