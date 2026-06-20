"use client";

import { motion } from "framer-motion";
import { Loader2, Megaphone, Pause, Play, Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SpotlightCard } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";

type Campaign = {
  id: string;
  name: string;
  utilityProvider: string;
  status: "active" | "paused" | "completed";
  color: string;
  createdAt: string;
};

const tone = {
  active: { tone: "success" as const, label: "Active" },
  paused: { tone: "warning" as const, label: "Paused" },
  completed: { tone: "neutral" as const, label: "Completed" },
};

export function CampaignsView({ campaigns }: { campaigns: Campaign[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [utility, setUtility] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/campaigns", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, utilityProvider: utility }),
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
    const next = c.status === "active" ? "paused" : "active";
    await fetch("/api/campaigns", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: c.id, status: next }),
    });
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Campaign name</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Spring Sunrun Resolution"
                autoFocus
              />
            </div>
            <div>
              <Label>Utility provider</Label>
              <Input
                value={utility}
                onChange={(e) => setUtility(e.target.value)}
                placeholder="PG&E"
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
            Create a campaign to organize outreach by utility provider and territory.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => {
            const cfg = tone[c.status];
            return (
              <SpotlightCard key={c.id} className="flex flex-col overflow-hidden">
                <div className="h-1.5 w-full" style={{ background: c.color }} />
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold leading-tight">{c.name}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.utilityProvider || "All providers"}
                      </p>
                    </div>
                    <Badge tone={cfg.tone} dot>
                      {cfg.label}
                    </Badge>
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Created {new Date(c.createdAt).toLocaleDateString()}
                  </p>
                  <div className="mt-5 border-t border-border pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-1.5"
                      onClick={() => toggle(c)}
                      disabled={c.status === "completed"}
                    >
                      {c.status === "active" ? (
                        <>
                          <Pause className="h-3.5 w-3.5" /> Pause
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" /> Resume
                        </>
                      )}
                    </Button>
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
