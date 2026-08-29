"use client";

import { Download, Eye, EyeOff, Loader2, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "@/components/shared/section-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { countSegments } from "@/lib/messaging/render";

// ─────────────────────────────────────────────────────────────────────────────
// The wording a playbook is allowed to propose.
//
// Seeds install as DRAFTS and publishing is a deliberate act, for the same
// reason the playbook seeds do: a human should read every word before a
// customer does. Publishing runs a real render first, so a template using a
// variable the renderer cannot fill is refused here rather than discovered
// when it arrives on someone's phone as "Hi {{firstName}}".
// ─────────────────────────────────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  key: string;
  name: string;
  version: number;
  status: string;
  scope: string;
  body: string;
  publishedAt: string | null;
}
interface Available {
  key: string;
  name: string;
  scope: string;
  purpose: string;
}

export function MessageTemplates({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [available, setAvailable] = useState<Available[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/messaging/templates", { cache: "no-store" });
      if (res.ok) {
        const j = (await res.json()) as { templates: TemplateRow[]; available: Available[] };
        setTemplates(j.templates ?? []);
        setAvailable(j.available ?? []);
      }
    } catch {
      /* the empty state below is honest enough */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, payload: Record<string, unknown>, label: string) {
    setBusy(label);
    try {
      const res = await fetch("/api/messaging/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        installed?: number;
        segments?: number;
      };
      if (!res.ok) {
        toast({ title: j.error ?? "That didn't work.", tone: "danger" });
        return;
      }
      if (action === "install") {
        toast({
          title: `${j.installed ?? 0} installed as drafts`,
          description: "Read each one, then publish the ones you want playbooks to use.",
          tone: "success",
        });
      } else if (action === "publish") {
        toast({
          title: "Published",
          description: `Playbooks can propose this wording now. ${j.segments ?? 1} segment${(j.segments ?? 1) === 1 ? "" : "s"} per message.`,
          tone: "success",
        });
      } else {
        toast({ title: "Unpublished", description: "No playbook can propose it now." });
      }
      await load();
    } catch {
      toast({ title: "That didn't work.", tone: "danger" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SectionCard
      title="Message templates"
      description="The only wording a playbook may propose. Nothing is published until someone reads it."
    >
      {loading && templates.length === 0 ? (
        <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        <>
          {available.length > 0 && (
            <div className="mb-3 rounded-xl border border-border/70 bg-muted/30 p-3">
              <p className="text-sm font-medium">
                {available.length} starting point{available.length === 1 ? "" : "s"} not installed
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                They install as drafts — nothing is sent, and nothing is published.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                disabled={!canEdit || busy === "install"}
                onClick={() => void act("install", {}, "install")}
              >
                {busy === "install" ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                )}
                Install {available.length}
              </Button>
            </div>
          )}

          {templates.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">
              No templates yet. A playbook&apos;s send_message step has nothing to propose until
              one is published.
            </p>
          ) : (
            <ul className="space-y-2">
              {templates.map((t) => {
                const published = t.status === "published";
                const segments = countSegments(t.body);
                return (
                  <li
                    key={t.id}
                    className="rounded-xl border border-border/70 bg-card p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{t.name || t.key}</span>
                      <Badge tone={published ? "success" : "neutral"}>
                        {published ? "Published" : "Draft"}
                      </Badge>
                      {t.scope === "promotional" && (
                        // Worth flagging: this one needs a real opt-in, which
                        // almost nobody in an imported book has.
                        <Badge tone="warning">Needs marketing consent</Badge>
                      )}
                      <span className="ml-auto text-xs text-muted-foreground tabular">
                        {segments} segment{segments === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted/40 p-2 text-sm">
                      {t.body}
                    </p>
                    <div className="mt-2">
                      <Button
                        size="sm"
                        variant={published ? "ghost" : "secondary"}
                        disabled={!canEdit || busy === t.id}
                        onClick={() =>
                          void act(published ? "unpublish" : "publish", { id: t.id }, t.id)
                        }
                      >
                        {busy === t.id ? (
                          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : published ? (
                          <EyeOff className="mr-1.5 h-3.5 w-3.5" />
                        ) : (
                          <Eye className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {published ? "Unpublish" : "Publish"}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground">
            <Send className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Publishing does not send anything. It only makes the wording available for a
              playbook to propose — and every proposal still waits for a person.
            </span>
          </p>
        </>
      )}
    </SectionCard>
  );
}
