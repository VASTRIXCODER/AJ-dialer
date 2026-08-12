"use client";

import { Loader2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { campaignStatusConfig } from "@/lib/status";
import type { CampaignStatus } from "@/lib/types";

/** The slice of a campaign the edit dialog needs (and can change). */
export interface EditableCampaign {
  id: string;
  name: string;
  utilityProvider: string;
  color: string;
  status: CampaignStatus;
  /** Call scripts ("" = unset). Setting BOTH runs an A/B test in the dialer. */
  scriptA: string;
  scriptB: string;
}

/**
 * Edit a campaign's name, utility provider, color, and status — the one place
 * "completed" can be set (the card's pause/resume toggle only flips
 * active/paused). PATCHes /api/campaigns; the server enforces that the actor
 * may touch this campaign. Shared by the Campaigns grid and the detail page.
 */
export function EditCampaignDialog({
  campaign,
  onClose,
}: {
  campaign: EditableCampaign;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [utility, setUtility] = useState(campaign.utilityProvider);
  const [color, setColor] = useState(campaign.color || "#3B82F6");
  const [status, setStatus] = useState<CampaignStatus>(campaign.status);
  const [scriptA, setScriptA] = useState(campaign.scriptA);
  const [scriptB, setScriptB] = useState(campaign.scriptB);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setErr("Name is required.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/campaigns", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: campaign.id,
          name,
          utilityProvider: utility,
          color,
          status,
          scriptA,
          scriptB,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setErr(json.error ?? "Couldn't save changes.");
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setErr("Network error while saving.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} label={`Edit ${campaign.name}`} dismissible={!busy}>
      <form onSubmit={save} className="flex min-h-0 flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-border/60 p-5">
          <div>
            <p className="text-base font-semibold leading-tight">Edit campaign</p>
            <p className="text-xs text-muted-foreground">
              Changes apply everywhere this campaign appears.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto p-5">
          <div>
            <Label htmlFor="campaign-edit-name">Campaign name</Label>
            <Input
              id="campaign-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Spring Resolution"
            />
          </div>
          <div>
            <Label htmlFor="campaign-edit-utility">Utility provider</Label>
            <Input
              id="campaign-edit-utility"
              value={utility}
              onChange={(e) => setUtility(e.target.value)}
              placeholder="PG&E"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Leave blank to target all providers.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="campaign-edit-color">Color</Label>
              <input
                id="campaign-edit-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-full cursor-pointer rounded-xl border border-border bg-background"
                aria-label="Campaign color"
              />
            </div>
            <div>
              <Label htmlFor="campaign-edit-status">Status</Label>
              <Select
                id="campaign-edit-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as CampaignStatus)}
              >
                {(Object.keys(campaignStatusConfig) as CampaignStatus[]).map((value) => (
                  <option key={value} value={value}>
                    {campaignStatusConfig[value].label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Completed campaigns drop out of the pause/resume toggle — reactivate them here.
          </p>
          <div>
            <Label htmlFor="campaign-edit-script-a">Script A</Label>
            <Textarea
              id="campaign-edit-script-a"
              value={scriptA}
              onChange={(e) => setScriptA(e.target.value)}
              placeholder="Hi {first name}, this is … calling about your solar account review…"
            />
          </div>
          <div>
            <Label htmlFor="campaign-edit-script-b">
              Script B (leave empty to run a single script)
            </Label>
            <Textarea
              id="campaign-edit-script-b"
              value={scriptB}
              onChange={(e) => setScriptB(e.target.value)}
              placeholder="An alternative opener to test against Script A…"
            />
            <p className="mt-1.5 text-xs text-muted-foreground">
              With both scripts set, the dialer runs an A/B test: each lead is
              deterministically assigned one script, and results split on the campaign page.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border/60 p-5">
          {err && <p className="mr-auto text-sm font-medium text-danger">{err}</p>}
          <Button type="button" variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1 gap-2" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}
