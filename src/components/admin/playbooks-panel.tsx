"use client";

import { AlertTriangle, BookOpenCheck, Loader2, Pause, Play, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, relativeTime } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Playbooks (P2.2 Studio-lite) — install the seed templates, publish/pause/
// retire, and the org's orchestration master switch. The visual builder is
// P2.10; until then a playbook's definition is exactly its template.
// ─────────────────────────────────────────────────────────────────────────────

interface PlaybookRow {
  id: string;
  name: string;
  version: number;
  status: "draft" | "published" | "paused" | "retired";
  published_at: string | null;
}
interface TemplateRow {
  key: string;
  name: string;
  trigger: string;
  steps: number;
}

const STATUS_TONE: Record<PlaybookRow["status"], "success" | "warning" | "neutral"> = {
  published: "success",
  paused: "warning",
  draft: "neutral",
  retired: "neutral",
};

interface EngineHealth {
  lastTickAt: string | null;
  running: boolean;
}

export function PlaybooksPanel() {
  const router = useRouter();
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [validation, setValidation] = useState<string[]>([]);
  const [engine, setEngine] = useState<EngineHealth | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/playbooks", { cache: "no-store" });
      if (!res.ok) return;
      const j = (await res.json()) as {
        playbooks: PlaybookRow[];
        templates: TemplateRow[];
        orchestrationEnabled: boolean;
        engine?: EngineHealth;
      };
      setPlaybooks(j.playbooks ?? []);
      setTemplates(j.templates ?? []);
      setEnabled(Boolean(j.orchestrationEnabled));
      setEngine(j.engine ?? null);
    } finally {
      setLoaded(true);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (key: string, run: () => Promise<Response>) => {
    setBusy(key);
    setErr(null);
    setValidation([]);
    try {
      const res = await run();
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        validation?: string[];
      };
      if (!res.ok) {
        setErr(j.error ?? "That didn't work.");
        setValidation(j.validation ?? []);
        return;
      }
      await refresh();
      router.refresh();
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(null);
    }
  };

  const setMasterSwitch = (on: boolean) =>
    act("master", () =>
      fetch("/api/org/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings: { orchestration: { enabled: on } } }),
      }),
    );

  const installed = new Set(playbooks.filter((p) => p.status !== "retired").map((p) => p.name));

  return (
    <SectionCard
      title="Playbooks"
      description="Automated follow-through: install a template, publish it, and the orchestration engine enforces it — deterministically, with kill switches at every level."
    >
      {/* Master switch — level 2 of the kill-switch hierarchy. */}
      <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/70 bg-surface/50 px-4 py-3">
        <span>
          <span className="block text-sm font-medium">Orchestration engine</span>
          <span className="block text-xs text-muted-foreground">
            OFF by default. Nothing activates or executes for this workspace until
            this is on — published playbooks just wait. Turning it off mid-flight
            freezes new actions; in-flight state and the audit trail are kept.
          </span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          disabled={busy === "master" || !loaded}
          onChange={(e) => setMasterSwitch(e.target.checked)}
          className="h-[22px] w-[22px] accent-[hsl(var(--primary))]"
        />
      </label>

      {/* Is the engine actually running? Switching orchestration on does
          nothing until the orchestrate cron is scheduled, and without this
          line that failure is completely silent — the switch reads ON and no
          work ever appears. */}
      {loaded && enabled && engine && !engine.running && (
        <p
          className="mt-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning"
          role="status"
        >
          <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            <strong>The engine is not running.</strong>{" "}
            {engine.lastTickAt
              ? `Its last tick was ${relativeTime(engine.lastTickAt)}, so published playbooks are not being enforced right now.`
              : "It has never run, so published playbooks will sit idle no matter what they say."}{" "}
            Schedule the orchestrate job (see supabase/cron.sql) to start it.
          </span>
        </p>
      )}
      {loaded && enabled && engine?.running && (
        <p className="mt-3 text-xs text-muted-foreground">
          Engine running · last tick {relativeTime(engine.lastTickAt as string)}.
        </p>
      )}

      {err && (
        <p className="mt-3 text-sm font-medium text-danger" role="alert">
          {err}
        </p>
      )}
      {validation.length > 0 && (
        <ul className="mt-1 list-inside list-disc text-xs text-danger">
          {validation.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      )}

      {/* Installed playbooks */}
      <div className="mt-4 space-y-2">
        {!loaded ? (
          <div className="skeleton h-14 rounded-xl" />
        ) : playbooks.filter((p) => p.status !== "retired").length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
            No playbooks yet — install a template below to start.
          </p>
        ) : (
          playbooks
            .filter((p) => p.status !== "retired")
            .map((p) => (
              <div
                key={p.id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-surface/50 px-4 py-3",
                  p.status === "paused" && "opacity-80",
                )}
              >
                <BookOpenCheck className="h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.name}</p>
                  <p className="text-xs text-muted-foreground">v{p.version}</p>
                </div>
                <Badge tone={STATUS_TONE[p.status]} className="capitalize">
                  {p.status}
                </Badge>
                {(p.status === "draft" || p.status === "paused") && (
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={busy === p.id}
                    onClick={() =>
                      act(p.id, () =>
                        fetch("/api/playbooks", {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({
                            id: p.id,
                            action: p.status === "draft" ? "publish" : "resume",
                          }),
                        }),
                      )
                    }
                  >
                    {busy === p.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {p.status === "draft" ? "Publish" : "Resume"}
                  </Button>
                )}
                {p.status === "published" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={busy === p.id}
                    onClick={() =>
                      act(p.id, () =>
                        fetch("/api/playbooks", {
                          method: "PATCH",
                          headers: { "content-type": "application/json" },
                          body: JSON.stringify({ id: p.id, action: "pause" }),
                        }),
                      )
                    }
                  >
                    <Pause className="h-3.5 w-3.5" />
                    Pause
                  </Button>
                )}
                <button
                  type="button"
                  aria-label={`Retire ${p.name}`}
                  title="Retire — stops its running instances on the next tick; history stays."
                  disabled={busy === p.id}
                  onClick={() =>
                    act(p.id, () =>
                      fetch("/api/playbooks", {
                        method: "PATCH",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ id: p.id, action: "retire" }),
                      }),
                    )
                  }
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))
        )}
      </div>

      {/* Templates */}
      <h4 className="mt-5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
        Templates
      </h4>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {templates.map((t) => (
          <div
            key={t.key}
            className="flex flex-col rounded-xl border border-border/70 bg-surface/50 p-3"
          >
            <p className="text-sm font-semibold">{t.name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t.steps} steps · fires on {t.trigger.replace(/_/g, " ")}
            </p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3 gap-1.5 self-start"
              disabled={busy === t.key || installed.has(t.name)}
              onClick={() =>
                act(t.key, () =>
                  fetch("/api/playbooks", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ templateKey: t.key }),
                  }),
                )
              }
            >
              {busy === t.key ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {installed.has(t.name) ? "Installed" : "Install as draft"}
            </Button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Publishing runs strict validation — a playbook can never promise an action
        the engine can’t safely execute yet. Every publish, pause, and retire is
        audited. Escalations surface as signals (the hot queue reads them).
      </p>
    </SectionCard>
  );
}
