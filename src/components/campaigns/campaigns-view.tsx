"use client";

import { motion } from "framer-motion";
import {
  ArrowRight,
  Loader2,
  Megaphone,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SpotlightCard } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Input, Label } from "@/components/ui/input";
import type { CampaignStats } from "@/lib/campaign-stats";
import { campaignStatusConfig } from "@/lib/status";
import type { CampaignStatus } from "@/lib/types";

type Campaign = {
  id: string;
  name: string;
  utilityProvider: string;
  status: CampaignStatus;
  color: string;
  createdAt: string;
  ownerId: string | null;
  /** One-line description ("" = none) — shown on the card when present. */
  description: string;
  /** Set = archived: kept for history, visually parked. */
  archivedAt: string | null;
  stats: CampaignStats;
};

export function CampaignsView({
  campaigns,
  providerLabel,
}: {
  campaigns: Campaign[];
  /** The org's resolved label for the utilityProvider core slot — never a
   *  hardcoded industry noun (vocab audit: this form used to say "Utility
   *  provider" to every vertical). */
  providerLabel: string;
}) {
  const router = useRouter();
  const confirmDialog = useConfirm();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [utility, setUtility] = useState("");
  const [color, setColor] = useState("#2563eb");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, utilityProvider: utility, color }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !j.ok) {
      setErr(j.error ?? "Could not create campaign.");
      return;
    }
    setName("");
    setUtility("");
    setOpen(false);
    router.refresh();
  }

  async function toggle(c: Campaign) {
    setPendingId(c.id);
    const next = c.status === "active" ? "paused" : "active";
    await fetch("/api/campaigns", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: c.id, status: next }),
    });
    setPendingId(null);
    router.refresh();
  }

  async function remove(c: Campaign) {
    const ok = await confirmDialog({
      title: `Delete "${c.name}"?`,
      body: "Its leads stay, just un-assigned.",
      tone: "danger",
      confirmLabel: "Delete campaign",
    });
    if (!ok) return;
    setPendingId(c.id);
    await fetch("/api/campaigns", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: c.id }),
    });
    setPendingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={() => setOpen((v) => !v)}>
          {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {open ? "Cancel" : "New campaign"}
        </Button>
      </div>

      {open && (
        <motion.form
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          onSubmit={create}
          className="surface-glass rounded-2xl border border-border/60 p-5"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label>Campaign name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Spring outreach" autoFocus />
            </div>
            <div>
              {/* The org's own field label (resolved schema), not a literal. */}
              <Label>{providerLabel}</Label>
              <Input
                value={utility}
                onChange={(e) => setUtility(e.target.value)}
                placeholder="Leave blank to target all"
              />
            </div>
            <div>
              <Label>Color</Label>
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-full cursor-pointer rounded-xl border border-border bg-background"
                aria-label="Campaign color"
              />
            </div>
          </div>
          {err && <p className="mt-3 text-sm text-danger">{err}</p>}
          <div className="mt-4 flex justify-end">
            <Button type="submit" size="sm" className="gap-2" disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Create campaign
            </Button>
          </div>
        </motion.form>
      )}

      {campaigns.length === 0 ? (
        <div className="surface-glass flex flex-col items-center rounded-2xl border border-border/60 p-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary">
            <Megaphone className="h-7 w-7" />
          </span>
          <p className="mt-4 font-semibold">No campaigns yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a campaign, assign leads to it, then dial it from the Power Dialer.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => {
            const cfg = campaignStatusConfig[c.status];
            const st = c.stats;
            const pending = pendingId === c.id;
            return (
              <SpotlightCard
                key={c.id}
                className={`flex flex-col overflow-hidden ${c.archivedAt ? "opacity-60" : ""}`}
              >
                <div className="h-1.5 w-full" style={{ background: c.color }} />
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold leading-tight">{c.name}</h3>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {c.description || c.utilityProvider || "All segments"}
                      </p>
                    </div>
                    {c.archivedAt ? (
                      <Badge tone="warning">Archived</Badge>
                    ) : (
                      <Badge tone={cfg.tone} dot>
                        {cfg.label}
                      </Badge>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <Stat label="Leads" value={st.totalLeads} />
                    <Stat label="Dialable" value={st.dialableLeads} />
                    <Stat label="Calls" value={st.calls} />
                    <Stat label="Appts" value={st.appointments} accent />
                  </div>
                  <div className="mt-3 space-y-2">
                    <Bar label="Contact rate" value={st.contactRate} />
                    <Bar label="Connect rate" value={st.connectRate} />
                  </div>

                  <div className="mt-5 flex items-center gap-2 border-t border-border pt-4">
                    <Link
                      href={`/campaigns/${c.id}`}
                      className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-muted"
                    >
                      View
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    {/* Editing lives in the Campaign Builder now (retired the
                        old modal) — one surface, every setting. */}
                    <Link
                      href={`/campaigns/${c.id}/edit`}
                      aria-label={`Edit ${c.name}`}
                      className="inline-flex h-8 items-center justify-center rounded-xl border border-border px-2.5 transition-colors hover:bg-muted"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Link>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => toggle(c)}
                      disabled={c.status === "completed" || pending}
                      aria-label={c.status === "active" ? `Pause ${c.name}` : `Resume ${c.name}`}
                    >
                      {pending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : c.status === "active" ? (
                        <Pause className="h-3.5 w-3.5" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <button
                      type="button"
                      onClick={() => remove(c)}
                      disabled={pending}
                      aria-label="Delete campaign"
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </SpotlightCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/60 p-2.5 text-center">
      <p className={`text-lg font-bold tabular ${accent ? "text-primary" : ""}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground">{label}</p>
    </div>
  );
}

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular">{value}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}
